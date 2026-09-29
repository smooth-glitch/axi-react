/**
 * RFC 6238 TOTP helper for testing and development.
 * Computes 6-digit TOTP using standard Base32 decoding and Web Crypto API HMAC-SHA1.
 */

function base32ToBytes(base32) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  const clean = (base32 || '').toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const output = [];

  for (let i = 0; i < clean.length; i++) {
    const idx = alphabet.indexOf(clean[i]);
    if (idx === -1) continue;
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      output.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return new Uint8Array(output);
}

export async function generateTotpCode(secret, step = 30) {
  if (!secret) return null;
  try {
    const keyBytes = base32ToBytes(secret);
    if (keyBytes.length === 0) return null;

    const epochSec = Math.floor(Date.now() / 1000);
    const counter = Math.floor(epochSec / step);

    // 8-byte big-endian counter
    const counterBuffer = new ArrayBuffer(8);
    const counterView = new DataView(counterBuffer);
    counterView.setBigUint64(0, BigInt(counter));

    const cryptoKey = await window.crypto.subtle.importKey(
      'raw',
      keyBytes,
      { name: 'HMAC', hash: { name: 'SHA-1' } },
      false,
      ['sign']
    );

    const signature = await window.crypto.subtle.sign('HMAC', cryptoKey, counterBuffer);
    const sigBytes = new Uint8Array(signature);

    const offset = sigBytes[sigBytes.length - 1] & 0x0f;
    const binary =
      ((sigBytes[offset] & 0x7f) << 24) |
      ((sigBytes[offset + 1] & 0xff) << 16) |
      ((sigBytes[offset + 2] & 0xff) << 8) |
      (sigBytes[offset + 3] & 0xff);

    const otp = binary % 1000000;
    return otp.toString().padStart(6, '0');
  } catch (err) {
    console.warn('[TotpHelper] Failed to generate TOTP code:', err);
    return null;
  }
}

export function getTotpTimeRemaining(step = 30) {
  const epochSec = Math.floor(Date.now() / 1000);
  return step - (epochSec % step);
}
