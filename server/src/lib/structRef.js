const { getJSON, hget } = require('./redis');

// Redis: hash mapping a struct's stable, human-readable `key` (e.g. "leave-request") to its uuid.
const KEYS_HASH = 'structs:keys';
const structKey = (id) => `struct:${id}`;

const KEY_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const UUID_LIKE = /^[0-9a-f]{8}-[0-9a-f]{4}-/i;

// Returns an error message or null. Keys must not look like uuids so ids and keys can never collide.
function keyError(key) {
  if (typeof key !== 'string' || !KEY_RE.test(key) || UUID_LIKE.test(key)) {
    return 'key must be 1-64 characters (letters, digits, _ or -), start with a letter and not look like a uuid';
  }
  return null;
}

// Accepts either a struct id or a struct key; returns the struct id, or null when nothing matches.
async function resolveStructId(ref) {
  if (!ref) return null;
  if (await getJSON(structKey(ref))) return ref;
  return (await hget(KEYS_HASH, ref)) || null;
}

module.exports = { KEYS_HASH, keyError, resolveStructId };
