// SHA256d (double SHA-256) hashing of a block header, and comparison of
// the resulting hash against the current network target.
//
// Byte-order note: sha256d() returns the raw digest in the order the hash
// function produces it ("internal" order) — the same order used inside a
// serialized header/merkle tree. The conventional display hash you see on
// block explorers is that digest byte-reversed. toDisplayHex() does that
// reversal; hashToBigInt() also reverses (to read the digest as the
// little-endian integer Bitcoin compares against target).

import crypto from 'node:crypto';

export function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest();
}

export function sha256d(buffer) {
  return sha256(sha256(buffer));
}

export function toDisplayHex(hashBuffer) {
  return Buffer.from(hashBuffer).reverse().toString('hex');
}

export function hashToBigInt(hashBuffer) {
  const reversed = Buffer.from(hashBuffer).reverse();
  return BigInt('0x' + reversed.toString('hex'));
}

// Expands the compact "bits" encoding (as returned by getblocktemplate,
// e.g. "1d00ffff") into the full 256-bit target, as a BigInt.
export function bitsToTarget(bits) {
  const bitsNum = typeof bits === 'string' ? parseInt(bits, 16) : bits;
  const exponent = bitsNum >>> 24;
  const mantissa = BigInt(bitsNum & 0x007fffff);
  return exponent <= 3
    ? mantissa >> BigInt(8 * (3 - exponent))
    : mantissa << BigInt(8 * (exponent - 3));
}

export function meetsTarget(hashBuffer, target) {
  const targetValue = typeof target === 'bigint' ? target : bitsToTarget(target);
  return hashToBigInt(hashBuffer) <= targetValue;
}

// Number of leading zero bits in the hash's numeric (display) value —
// handy for a "how close was that" visualization.
export function countLeadingZeroBits(hashBuffer) {
  const value = hashToBigInt(hashBuffer);
  if (value === 0n) return hashBuffer.length * 8;
  return hashBuffer.length * 8 - value.toString(2).length;
}
