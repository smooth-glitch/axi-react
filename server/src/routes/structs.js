const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getJSON, setJSON, sadd, smembers, scard, hget, hset, hdel } = require('../lib/redis');
const { KEYS_HASH, keyError, resolveStructId } = require('../lib/structRef');
const logger = require('../lib/logger');

const router = express.Router();

const FIELD_TYPES = ['text', 'date', 'time', 'wholeNumber', 'number', 'email', 'url', 'mobile', 'location', 'list', 'selection', 'fill'];

// Returns an error message, or null when the definition is acceptable.
function definitionError({ name, fields, sections }) {
  if (!name || typeof name !== 'string' || !name.trim()) return 'name is required';
  if (!Array.isArray(fields) || fields.length === 0) return 'fields must be a non-empty array';
  const seen = new Set();
  for (const f of fields) {
    if (!f || !f.id || !f.label || !FIELD_TYPES.includes(f.type)) return 'every field needs an id, a label and a valid type';
    if (seen.has(f.id)) return `duplicate field id "${f.id}"`;
    seen.add(f.id);
  }
  return null;
}

const STRUCTS_INDEX = 'structs:index';
const structKey = (id) => `struct:${id}`;

// POST /api/structs — create a struct definition. Optional `key`: a stable human-readable alias usable
// anywhere a struct id is accepted (e.g. "leave-request").
router.post('/', async (req, res) => {
  const { name, fields, sections, key } = req.body || {};

  const bad = definitionError({ name, fields, sections });
  if (bad) return res.status(400).json({ error: bad });
  if (key !== undefined && key !== null && key !== '') {
    const kerr = keyError(key);
    if (kerr) return res.status(400).json({ error: kerr });
    if ((await hget(KEYS_HASH, key)) || (await getJSON(structKey(key)))) return res.status(409).json({ error: `key "${key}" is already in use` });
  }

  const id = uuidv4();
  const struct = {
    id,
    ...(key ? { key } : {}),
    name: name.trim(),
    fields,
    sections: Array.isArray(sections) ? sections : [],
    createdBy: (req.body && req.body.createdBy) || req.user || 'anonymous',
    createdAt: new Date().toISOString(),
  };

  await setJSON(structKey(id), struct);
  await sadd(STRUCTS_INDEX, id);
  if (key) await hset(KEYS_HASH, key, id);

  logger.info({ event: 'structs.create', structId: id, key, name: struct.name }, 'Struct created');
  res.status(201).json({ structId: id, struct });
});

// GET /api/structs — list all struct definitions (id + name, plus counts for the UI)
router.get('/', async (req, res) => {
  const ids = await smembers(STRUCTS_INDEX);
  const structs = [];
  for (const id of ids) {
    const s = await getJSON(structKey(id));
    if (s) {
      const recordCount = await scard(`records:${id}:index`);
      structs.push({
        id: s.id,
        key: s.key,
        name: s.name,
        createdAt: s.createdAt,
        modifiedAt: s.modifiedAt,
        fieldCount: s.fields.length,
        sectionCount: (s.sections || []).length,
        recordCount,
      });
    }
  }
  structs.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  logger.info({ event: 'structs.list', count: structs.length }, 'Structs listed');
  res.json({ structs });
});

// GET /api/structs/:structRef — full struct definition (:structRef is an id or a key)
router.get('/:structRef', async (req, res) => {
  const { structRef } = req.params;
  const id = await resolveStructId(structRef);
  const struct = id ? await getJSON(structKey(id)) : null;
  if (!struct) {
    logger.warn({ event: 'structs.get.notfound', structRef }, 'Struct not found');
    return res.status(404).json({ error: 'Struct not found' });
  }
  res.json({ struct });
});

// PUT /api/structs/:structRef — replace a struct definition (id, createdBy and createdAt are kept).
// `key`: omit to keep the current one, send a string to set/change it, or null/"" to remove it.
// Existing records are not migrated: they keep whatever values they were saved with.
router.put('/:structRef', async (req, res) => {
  const { structRef } = req.params;
  const structId = await resolveStructId(structRef);
  const existing = structId ? await getJSON(structKey(structId)) : null;
  if (!existing) {
    logger.warn({ event: 'structs.update.notfound', structRef }, 'Struct not found for update');
    return res.status(404).json({ error: 'Struct not found' });
  }
  const { name, fields, sections, modifiedBy, key } = req.body || {};
  const bad = definitionError({ name, fields, sections });
  if (bad) return res.status(400).json({ error: bad });

  let nextKey = existing.key;
  if (key !== undefined) {
    nextKey = key === null || key === '' ? undefined : key;
    if (nextKey) {
      const kerr = keyError(nextKey);
      if (kerr) return res.status(400).json({ error: kerr });
      const owner = await hget(KEYS_HASH, nextKey);
      if ((owner && owner !== structId) || ((await getJSON(structKey(nextKey))) && nextKey !== structId)) {
        return res.status(409).json({ error: `key "${nextKey}" is already in use` });
      }
    }
  }

  const struct = {
    ...existing,
    name: name.trim(),
    fields,
    sections: Array.isArray(sections) ? sections : [],
    modifiedBy: modifiedBy || req.user || 'anonymous',
    modifiedAt: new Date().toISOString(),
  };
  if (nextKey) struct.key = nextKey;
  else delete struct.key;

  await setJSON(structKey(structId), struct);
  if (existing.key && existing.key !== nextKey) await hdel(KEYS_HASH, existing.key);
  if (nextKey && existing.key !== nextKey) await hset(KEYS_HASH, nextKey, structId);

  logger.info({ event: 'structs.update', structId, key: nextKey, name: struct.name }, 'Struct updated');
  res.json({ structId, struct });
});

module.exports = router;
