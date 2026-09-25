const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getJSON, setJSON, sadd, smembers } = require('../lib/redis');
const { resolveStructId } = require('../lib/structRef');
const { validateRecord } = require('../lib/validate');
const logger = require('../lib/logger');

// mergeParams so we can read :structId from the parent router mount
const router = express.Router({ mergeParams: true });

const structKey = (id) => `struct:${id}`;
const recordKey = (structId, recordId) => `record:${structId}:${recordId}`;
const recordsIndexKey = (structId) => `records:${structId}:index`;

// :structId may be a struct id or its key; every handler below works with req.structId (the real id).
router.use(async (req, res, next) => {
  req.structId = (await resolveStructId(req.params.structId)) || req.params.structId;
  next();
});

// Optional linking fields a host application can attach to a record.
//   ref  - string (<= 200 chars), e.g. the host's own entity id ("order-123"); filterable with GET ?ref=
//   meta - plain JSON object with anything else the host wants to store alongside
function linkError({ ref, meta }) {
  if (ref !== undefined && ref !== null && (typeof ref !== 'string' || ref.length > 200)) return 'ref must be a string of at most 200 characters';
  if (meta !== undefined && meta !== null && (typeof meta !== 'object' || Array.isArray(meta))) return 'meta must be a JSON object';
  return null;
}

// POST /api/structs/:structId/records — save a record
router.post('/', async (req, res) => {
  const structId = req.structId;
  const { data, createdBy, ref, meta } = req.body || {};

  const struct = await getJSON(structKey(structId));
  if (!struct) {
    logger.warn({ event: 'records.create.structNotFound', structId }, 'Struct not found for record create');
    return res.status(404).json({ error: 'Struct not found' });
  }
  const badLink = linkError({ ref, meta });
  if (badLink) return res.status(400).json({ error: badLink });

  const { valid, errors } = validateRecord(struct, data || {});
  if (!valid) {
    logger.warn({ event: 'records.create.invalid', structId, errors }, 'Record failed validation');
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const id = uuidv4();
  const now = new Date().toISOString();
  const by = createdBy || req.user || 'anonymous';
  const record = {
    id,
    structId,
    data: data || {},
    ...(ref ? { ref } : {}),
    ...(meta ? { meta } : {}),
    createdBy: by,
    createdAt: now,
    modifiedBy: by,
    modifiedAt: now,
  };

  await setJSON(recordKey(structId, id), record);
  await sadd(recordsIndexKey(structId), id);

  logger.info({ event: 'records.create', structId, recordId: id, ref }, 'Record created');
  res.status(201).json({ recordId: id, record });
});

// GET /api/structs/:structId/records[?ref=...] — list records for a struct (newest first), optionally only those with a given ref
router.get('/', async (req, res) => {
  const structId = req.structId;
  const ids = await smembers(recordsIndexKey(structId));
  let records = [];
  for (const id of ids) {
    const r = await getJSON(recordKey(structId, id));
    if (r) records.push(r);
  }
  if (typeof req.query.ref === 'string' && req.query.ref) records = records.filter((r) => r.ref === req.query.ref);
  records.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  logger.info({ event: 'records.list', structId, count: records.length, ref: req.query.ref }, 'Records listed');
  res.json({ records });
});

// GET /api/structs/:structId/records/:recordId — get one record
router.get('/:recordId', async (req, res) => {
  const structId = req.structId;
  const { recordId } = req.params;
  const record = await getJSON(recordKey(structId, recordId));
  if (!record) {
    logger.warn({ event: 'records.get.notfound', structId, recordId }, 'Record not found');
    return res.status(404).json({ error: 'Record not found' });
  }
  res.json({ record });
});

// PUT /api/structs/:structId/records/:recordId — replace a record's data (validated against the current definition).
// id, structId, createdBy and createdAt are kept; modifiedBy / modifiedAt are updated.
// `ref` / `meta`: omit to keep, send a value to replace, or null to remove.
router.put('/:recordId', async (req, res) => {
  const structId = req.structId;
  const { recordId } = req.params;
  const { data, modifiedBy, ref, meta } = req.body || {};

  const struct = await getJSON(structKey(structId));
  if (!struct) {
    logger.warn({ event: 'records.update.structNotFound', structId }, 'Struct not found for record update');
    return res.status(404).json({ error: 'Struct not found' });
  }
  const existing = await getJSON(recordKey(structId, recordId));
  if (!existing) {
    logger.warn({ event: 'records.update.notfound', structId, recordId }, 'Record not found for update');
    return res.status(404).json({ error: 'Record not found' });
  }
  const badLink = linkError({ ref, meta });
  if (badLink) return res.status(400).json({ error: badLink });

  const { valid, errors } = validateRecord(struct, data || {});
  if (!valid) {
    logger.warn({ event: 'records.update.invalid', structId, recordId, errors }, 'Record update failed validation');
    return res.status(400).json({ error: 'Validation failed', errors });
  }

  const record = {
    ...existing,
    data: data || {},
    modifiedBy: modifiedBy || req.user || 'anonymous',
    modifiedAt: new Date().toISOString(),
  };
  if (ref !== undefined) (ref ? (record.ref = ref) : delete record.ref);
  if (meta !== undefined) (meta ? (record.meta = meta) : delete record.meta);
  await setJSON(recordKey(structId, recordId), record);

  logger.info({ event: 'records.update', structId, recordId }, 'Record updated');
  res.json({ recordId, record });
});

module.exports = router;
