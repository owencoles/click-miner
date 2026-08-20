// Builds the coinbase transaction for a candidate block: pays
// getblocktemplate's coinbasevalue (subsidy + fees) to the configured
// payout address, includes the BIP34 height push, and — when the template
// contains segwit transactions — the witness commitment output and the
// coinbase witness reserved value required by BIP141.

import crypto from 'node:crypto';
import { sha256d, toDisplayHex } from './hash.js';

const COINBASE_TAG = Buffer.from('/Click Miner/', 'utf8');

function opPush(bytes) {
  if (bytes.length === 0) return Buffer.alloc(0);
  if (bytes.length >= 0x4c) {
    throw new Error('push data too large for a direct push opcode');
  }
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

// Exported for reuse when assembling the full block (header + all
// transactions) for submitblock.
export function varInt(n) {
  const value = typeof n === 'bigint' ? n : BigInt(n);
  if (value < 0xfdn) return Buffer.from([Number(value)]);
  if (value <= 0xffffn) {
    const b = Buffer.alloc(3);
    b[0] = 0xfd;
    b.writeUInt16LE(Number(value), 1);
    return b;
  }
  if (value <= 0xffffffffn) {
    const b = Buffer.alloc(5);
    b[0] = 0xfe;
    b.writeUInt32LE(Number(value), 1);
    return b;
  }
  const b = Buffer.alloc(9);
  b[0] = 0xff;
  b.writeBigUInt64LE(value, 1);
  return b;
}

// Minimal, sign-correct CScriptNum encoding (used for the BIP34 height push).
function scriptNumEncode(n) {
  if (n === 0) return Buffer.alloc(0);
  const negative = n < 0;
  let abs = Math.abs(n);
  const bytes = [];
  while (abs > 0) {
    bytes.push(abs & 0xff);
    abs = Math.floor(abs / 256);
  }
  if (bytes[bytes.length - 1] & 0x80) {
    bytes.push(negative ? 0x80 : 0x00);
  } else if (negative) {
    bytes[bytes.length - 1] |= 0x80;
  }
  return Buffer.from(bytes);
}

function serializeOutput(valueSats, scriptPubKey) {
  const value = Buffer.alloc(8);
  value.writeBigUInt64LE(BigInt(valueSats), 0);
  return Buffer.concat([value, varInt(scriptPubKey.length), scriptPubKey]);
}

// template: a getblocktemplate result (height, coinbasevalue, and
// optionally default_witness_commitment).
// payoutScriptPubKey: Buffer, from address.js's decodeAddress().
// options.extraNonce: Buffer, defaults to 4 random bytes so repeated
// clicks against the same template still get distinct coinbase txids
// (and therefore distinct merkle roots) without needing a fresh template.
export function buildCoinbaseTransaction(template, payoutScriptPubKey, options = {}) {
  const height = template.height;
  const value = template.coinbasevalue;
  const witnessCommitmentHex = template.default_witness_commitment;
  const extraNonce = options.extraNonce ?? crypto.randomBytes(4);
  const version = options.version ?? 2;

  const scriptSig = Buffer.concat([
    opPush(scriptNumEncode(height)),
    opPush(COINBASE_TAG),
    opPush(extraNonce),
  ]);
  if (scriptSig.length < 2 || scriptSig.length > 100) {
    throw new Error(`coinbase scriptSig length ${scriptSig.length} out of consensus bounds (2-100)`);
  }

  const inputBody = Buffer.concat([
    Buffer.alloc(32), // prev txid: null for coinbase
    Buffer.from([0xff, 0xff, 0xff, 0xff]), // prev index: 0xffffffff for coinbase
    varInt(scriptSig.length),
    scriptSig,
    Buffer.from([0xff, 0xff, 0xff, 0xff]), // sequence
  ]);

  const outputs = [serializeOutput(value, payoutScriptPubKey)];
  if (witnessCommitmentHex) {
    outputs.push(serializeOutput(0, Buffer.from(witnessCommitmentHex, 'hex')));
  }

  const versionBuf = Buffer.alloc(4);
  versionBuf.writeInt32LE(version, 0);
  const locktimeBuf = Buffer.alloc(4); // 0

  const legacyTx = Buffer.concat([
    versionBuf,
    varInt(1),
    inputBody,
    varInt(outputs.length),
    ...outputs,
    locktimeBuf,
  ]);

  const txidInternal = sha256d(legacyTx);
  const txid = toDisplayHex(txidInternal);

  let rawTx = legacyTx;
  if (witnessCommitmentHex) {
    // BIP141: coinbase witness must be exactly one 32-byte reserved value.
    const witnessField = Buffer.concat([varInt(1), varInt(32), Buffer.alloc(32)]);
    rawTx = Buffer.concat([
      versionBuf,
      Buffer.from([0x00, 0x01]), // segwit marker + flag
      varInt(1),
      inputBody,
      varInt(outputs.length),
      ...outputs,
      witnessField,
      locktimeBuf,
    ]);
  }

  return { txid, txidInternal, legacyTx, rawTx, height, value };
}
