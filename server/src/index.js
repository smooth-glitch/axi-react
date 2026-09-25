const express = require('express');
const cors = require('cors');
const logger = require('./lib/logger');
const structsRouter = require('./routes/structs');
const recordsRouter = require('./routes/records');
const optionsRouter = require('./routes/options');
const filesRouter = require('./routes/files');

const app = express();
const PORT = process.env.PORT || 4000;

// CORS: open by default. Set CORS_ORIGINS="https://host-app.example,http://localhost:5173" to allow only those origins.
const origins = (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean);
// Content-Disposition is exposed so browser code can read the file name of a download.
app.use(cors({ ...(origins.length ? { origin: origins } : {}), exposedHeaders: ['Content-Disposition'] }));
app.use(express.json());

// Log every request in/out with timing.
app.use((req, res, next) => {
  const start = Date.now();
  logger.info({ event: 'req.in', method: req.method, path: req.originalUrl }, 'Request in');
  res.on('finish', () => {
    const ms = Date.now() - start;
    logger.info(
      { event: 'req.out', method: req.method, path: req.originalUrl, status: res.statusCode, ms },
      'Request out'
    );
  });
  next();
});

app.get('/health', (req, res) => res.json({ ok: true }));

// Optional shared-secret auth: set API_TOKEN and every /api request must send "Authorization: Bearer <token>".
// A host application can also identify the acting user with the "X-Tstruct-User" header; it becomes
// createdBy / modifiedBy when the request body doesn't specify one.
app.use('/api', (req, res, next) => {
  const token = process.env.API_TOKEN;
  if (token && req.get('authorization') !== `Bearer ${token}`) {
    logger.warn({ event: 'auth.denied', method: req.method, path: req.originalUrl }, 'Missing or wrong API token');
    return res.status(401).json({ error: 'Unauthorized' });
  }
  const user = req.get('x-tstruct-user');
  if (user) req.user = user.slice(0, 200);
  next();
});

app.use('/api/structs', structsRouter);
app.use('/api/structs/:structId/records', recordsRouter);
app.use('/api/options', optionsRouter);
app.use('/api/files', filesRouter);

// Basic error handler
app.use((err, req, res, next) => {
  logger.error({ event: 'error', err: err.message, stack: err.stack }, 'Unhandled error');
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, () => {
  logger.info({ event: 'server.start', port: PORT }, `Lite Tstruct Builder server listening on :${PORT}`);
});
