const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const { getJSON, setJSON, sadd, smembers } = require('../lib/redis');
const logger = require('../lib/logger');

const router = express.Router();

// Uploaded files live on the API server's local disk (server/uploads by default, override with UPLOAD_DIR).
// Redis holds only metadata:  file:<fileId> -> { id, originalName, mimeType, size, storedPath, uploadedAt }
//                             files:index   -> set of fileIds
const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '..', '..', 'uploads'));
const MAX_MB = Number(process.env.MAX_UPLOAD_MB) || 25;
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const FILES_INDEX = 'files:index';
const fileKey = (id) => `file:${id}`;

// multer hands us the multipart filename decoded as latin1. Browsers send UTF-8 bytes, so re-decode; if those bytes are not
// valid UTF-8 (e.g. curl on Windows sends the local code page) keep the name as it arrived.
const decodeName = (name) => {
  const raw = name || 'file';
  const utf8 = Buffer.from(raw, 'latin1').toString('utf8');
  return utf8.includes('�') ? raw : utf8;
};
const safeName = (name) => path.basename(name).replace(/[^A-Za-z0-9._-]+/g, '_').slice(-100) || 'file';

const upload = multer({
  storage: multer.diskStorage({
    destination: (req, file, cb) => cb(null, UPLOAD_DIR),
    filename: (req, file, cb) => {
      req.fileId = uuidv4(); // stored as "<uuid>-<sanitised original name>" so names can never collide
      cb(null, `${req.fileId}-${safeName(decodeName(file.originalname))}`);
    },
  }),
  limits: { fileSize: MAX_MB * 1024 * 1024, files: 1 },
});

// The path of a stored file is never sent to clients.
const publicMeta = ({ id, originalName, mimeType, size, uploadedAt, uploadedBy }) => ({ id, originalName, mimeType, size, uploadedAt, uploadedBy });

// POST /api/files — multipart upload (form field "file"); returns the new fileId
router.post('/', (req, res, next) => {
  upload.single('file')(req, res, async (err) => {
    if (err) {
      logger.warn({ event: 'files.upload.rejected', err: err.message, code: err.code }, 'Upload rejected');
      if (err.code === 'LIMIT_FILE_SIZE') return res.status(413).json({ error: `File is too large (max ${MAX_MB} MB)` });
      return res.status(400).json({ error: err.message });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received. Send multipart/form-data with a "file" field.' });
    try {
      const meta = {
        id: req.fileId,
        originalName: decodeName(req.file.originalname),
        mimeType: req.file.mimetype || 'application/octet-stream',
        size: req.file.size,
        storedPath: req.file.path,
        uploadedAt: new Date().toISOString(),
        uploadedBy: req.user || 'anonymous',
      };
      await setJSON(fileKey(meta.id), meta);
      await sadd(FILES_INDEX, meta.id);
      logger.info({ event: 'files.upload', fileId: meta.id, name: meta.originalName, size: meta.size }, 'File uploaded');
      res.status(201).json({ fileId: meta.id, file: publicMeta(meta) });
    } catch (e) {
      next(e);
    }
  });
});

// GET /api/files — metadata of all uploaded files, newest first (used to pick a previously uploaded file)
router.get('/', async (req, res) => {
  const ids = await smembers(FILES_INDEX);
  const files = [];
  for (const id of ids) {
    const f = await getJSON(fileKey(id));
    if (f) files.push(publicMeta(f));
  }
  files.sort((a, b) => (a.uploadedAt < b.uploadedAt ? 1 : -1));
  logger.info({ event: 'files.list', count: files.length }, 'Files listed');
  res.json({ files });
});

// GET /api/files/:fileId — streams the file back as a download (Content-Disposition: attachment)
router.get('/:fileId', async (req, res) => {
  const { fileId } = req.params;
  const meta = await getJSON(fileKey(fileId));
  // Only ever serve paths that live inside the upload directory (defence in depth: the path comes from Redis).
  const inside = meta && path.resolve(meta.storedPath).startsWith(UPLOAD_DIR + path.sep);
  if (!meta || !inside || !fs.existsSync(meta.storedPath)) {
    logger.warn({ event: 'files.get.notfound', fileId }, 'File not found');
    return res.status(404).json({ error: 'File not found' });
  }
  res.attachment(meta.originalName); // Content-Disposition: attachment; filename="..."; filename*=UTF-8''...
  res.type(meta.mimeType);
  res.set('Content-Length', String(meta.size));
  res.set('X-Content-Type-Options', 'nosniff');
  logger.info({ event: 'files.download', fileId, name: meta.originalName }, 'File download');
  const stream = fs.createReadStream(meta.storedPath);
  stream.on('error', (e) => {
    logger.error({ event: 'files.stream.error', fileId, err: e.message }, 'File stream error');
    if (!res.headersSent) res.status(500).json({ error: 'Could not read file' });
    else res.destroy(e);
  });
  stream.pipe(res);
});

module.exports = router;
module.exports.UPLOAD_DIR = UPLOAD_DIR;
