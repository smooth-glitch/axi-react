const Redis = require('ioredis');
const logger = require('./logger');

const redis = new Redis({
  host: process.env.REDIS_HOST || '127.0.0.1',
  port: Number(process.env.REDIS_PORT) || 6379,
});

redis.on('connect', () => logger.info({ event: 'redis.connect' }, 'Connected to Redis'));
redis.on('error', (err) => logger.error({ event: 'redis.error', err: err.message }, 'Redis error'));

// Wrapped helpers that log every read/write, per spec requirement.
async function getJSON(key) {
  const raw = await redis.get(key);
  logger.debug({ event: 'redis.get', key, found: raw !== null }, 'Redis GET');
  return raw ? JSON.parse(raw) : null;
}

async function setJSON(key, value) {
  const raw = JSON.stringify(value);
  await redis.set(key, raw);
  logger.debug({ event: 'redis.set', key }, 'Redis SET');
}

async function sadd(setKey, member) {
  await redis.sadd(setKey, member);
  logger.debug({ event: 'redis.sadd', setKey, member }, 'Redis SADD');
}

async function smembers(setKey) {
  const members = await redis.smembers(setKey);
  logger.debug({ event: 'redis.smembers', setKey, count: members.length }, 'Redis SMEMBERS');
  return members;
}

async function scard(setKey) {
  const n = await redis.scard(setKey);
  logger.debug({ event: 'redis.scard', setKey, count: n }, 'Redis SCARD');
  return n;
}

// Hash helpers (used for the struct key -> id lookup table).
async function hget(hashKey, field) {
  const v = await redis.hget(hashKey, field);
  logger.debug({ event: 'redis.hget', hashKey, field, found: v !== null }, 'Redis HGET');
  return v;
}

async function hset(hashKey, field, value) {
  await redis.hset(hashKey, field, value);
  logger.debug({ event: 'redis.hset', hashKey, field }, 'Redis HSET');
}

async function hdel(hashKey, field) {
  await redis.hdel(hashKey, field);
  logger.debug({ event: 'redis.hdel', hashKey, field }, 'Redis HDEL');
}

async function srem(setKey, member) {
  await redis.srem(setKey, member);
  logger.debug({ event: 'redis.srem', setKey, member }, 'Redis SREM');
}

async function del(key) {
  await redis.del(key);
  logger.debug({ event: 'redis.del', key }, 'Redis DEL');
}

module.exports = { redis, getJSON, setJSON, sadd, smembers, scard, srem, del, hget, hset, hdel };
