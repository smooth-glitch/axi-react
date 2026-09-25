const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { getJSON, setJSON, sadd, smembers, srem, del } = require('../lib/redis');
const { normalizeApplicable } = require('../lib/applicableTo'); // "applicable to" shape + rules: see lib/applicableTo.js
const logger = require('../lib/logger');

const router = express.Router();

// An Option is a standalone, configurable action/item (unrelated to any struct).
//   option:<optionId> -> { id, caption, type, config, applicableTo, createdBy, createdAt, modifiedBy?, modifiedAt? }
//   options:index     -> set of optionIds
const OPTIONS_INDEX = 'options:index';
const optionKey = (id) => `option:${id}`;
const fileKey = (id) => `file:${id}`;

const TYPES = ['dataInput', 'download', 'upload', 'apiDisplay', 'pay', 'axpertOption'];
const DISPLAY_AS = ['table', 'nameValuePair', 'text'];
const SUBTYPES = ['tstruct', 'smartView', 'iview', 'customPage'];

const isStr = (v) => typeof v === 'string';

// Returns { config } (normalised) or { error }.
async function normalizeConfig(type, config) {
  const c = config && typeof config === 'object' && !Array.isArray(config) ? config : {};
  switch (type) {
    case 'dataInput': {
      const structName = isStr(c.structName) ? c.structName.trim() : '';
      if (!structName) return { error: 'dataInput needs config.structName (the name of the struct to fill in)' };
      return { config: { structName } };
    }
    case 'download': {
      if (!isStr(c.fileId) || !c.fileId) return { error: 'download needs config.fileId (upload a file with POST /api/files first)' };
      if (!(await getJSON(fileKey(c.fileId)))) return { error: `file "${c.fileId}" does not exist` };
      return { config: { fileId: c.fileId } };
    }
    case 'upload':
      return { config: {} };
    case 'apiDisplay': {
      if (!DISPLAY_AS.includes(c.displayAs)) return { error: `apiDisplay needs config.displayAs: one of ${DISPLAY_AS.join(', ')}` };
      return { config: { apiName: isStr(c.apiName) ? c.apiName.trim() : '', displayAs: c.displayAs } };
    }
    case 'pay':
      return { config: { paymentConfig: isStr(c.paymentConfig) ? c.paymentConfig : '' } };
    case 'axpertOption': {
      if (!SUBTYPES.includes(c.subtype)) return { error: `axpertOption needs config.subtype: one of ${SUBTYPES.join(', ')}` };
      return { config: { subtype: c.subtype, target: isStr(c.target) ? c.target.trim() : '' } };
    }
    default:
      return { error: 'unknown type' };
  }
}

// Shared validation for POST and PUT. Returns { caption, type, config, applicableTo } or { error }.
async function validateBody(body) {
  const { caption, type } = body || {};
  if (!isStr(caption) || !caption.trim()) return { error: 'caption is required' };
  if (!TYPES.includes(type)) return { error: `type must be one of ${TYPES.join(', ')}` };
  const cfg = await normalizeConfig(type, body.config);
  if (cfg.error) return { error: cfg.error };
  const app = normalizeApplicable(body.applicableTo);
  if (app.error) return { error: app.error };
  return { caption: caption.trim(), type, config: cfg.config, applicableTo: app.applicableTo };
}

// POST /api/options
router.post('/', async (req, res) => {
  const v = await validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const id = uuidv4();
  const option = {
    id,
    caption: v.caption,
    type: v.type,
    config: v.config,
    applicableTo: v.applicableTo,
    createdBy: (req.body && req.body.createdBy) || req.user || 'anonymous',
    createdAt: new Date().toISOString(),
  };
  await setJSON(optionKey(id), option);
  await sadd(OPTIONS_INDEX, id);
  logger.info({ event: 'options.create', optionId: id, type: option.type }, 'Option created');
  res.status(201).json({ optionId: id, option });
});

// GET /api/options — all options, newest first
router.get('/', async (req, res) => {
  const ids = await smembers(OPTIONS_INDEX);
  const options = [];
  for (const id of ids) {
    const o = await getJSON(optionKey(id));
    if (o) options.push(o);
  }
  options.sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1));
  logger.info({ event: 'options.list', count: options.length }, 'Options listed');
  res.json({ options });
});

// GET /api/options/:optionId
router.get('/:optionId', async (req, res) => {
  const option = await getJSON(optionKey(req.params.optionId));
  if (!option) {
    logger.warn({ event: 'options.get.notfound', optionId: req.params.optionId }, 'Option not found');
    return res.status(404).json({ error: 'Option not found' });
  }
  res.json({ option });
});

// PUT /api/options/:optionId — replace caption / type / config / applicableTo (id, createdBy, createdAt are kept)
router.put('/:optionId', async (req, res) => {
  const { optionId } = req.params;
  const existing = await getJSON(optionKey(optionId));
  if (!existing) {
    logger.warn({ event: 'options.update.notfound', optionId }, 'Option not found for update');
    return res.status(404).json({ error: 'Option not found' });
  }
  const v = await validateBody(req.body);
  if (v.error) return res.status(400).json({ error: v.error });
  const option = {
    ...existing,
    caption: v.caption,
    type: v.type,
    config: v.config,
    applicableTo: v.applicableTo,
    modifiedBy: (req.body && req.body.modifiedBy) || req.user || 'anonymous',
    modifiedAt: new Date().toISOString(),
  };
  await setJSON(optionKey(optionId), option);
  logger.info({ event: 'options.update', optionId, type: option.type }, 'Option updated');
  res.json({ optionId, option });
});

// DELETE /api/options/:optionId — removes the option (an uploaded file it referenced stays in /api/files)
router.delete('/:optionId', async (req, res) => {
  const { optionId } = req.params;
  const existing = await getJSON(optionKey(optionId));
  if (!existing) {
    logger.warn({ event: 'options.delete.notfound', optionId }, 'Option not found for delete');
    return res.status(404).json({ error: 'Option not found' });
  }
  await del(optionKey(optionId));
  await srem(OPTIONS_INDEX, optionId);
  logger.info({ event: 'options.delete', optionId }, 'Option deleted');
  res.json({ optionId, deleted: true });
});

module.exports = router;
