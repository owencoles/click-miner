// Builds a candidate 80-byte block header from a getblocktemplate result:
// computes the merkle root from included transactions and assembles
// version, prevhash, merkleroot, time, bits, and nonce.
//
// Byte-order note: txids and previousblockhash come from bitcoind in
// conventional display order (big-endian hex, reverse of internal/raw
// byte order). Everything here converts to internal order before hashing
// or serializing, matching how the values sit in the raw header bytes.

import { sha256d } from './hash.js';

function toInternalOrder(hex) {
  return Buffer.from(hex, 'hex').reverse();
}

function merkleParents(level) {
  const next = [];
  for (let i = 0; i < level.length; i += 2) {
    const left = level[i];
    const right = i + 1 < level.length ? level[i + 1] : left;
    next.push(sha256d(Buffer.concat([left, right])));
  }
  return next;
}

// txids: array of hex strings in display order (as returned by
// getblocktemplate), coinbase txid first. Returns the merkle root as a
// 32-byte Buffer in internal order, ready to drop into the header.
export function computeMerkleRoot(txids) {
  if (!txids || txids.length === 0) {
    throw new Error('computeMerkleRoot requires at least one txid (the coinbase)');
  }
  let level = txids.map(toInternalOrder);
  while (level.length > 1) {
    level = merkleParents(level);
  }
  return level[0];
}

// template: a getblocktemplate result (version, previousblockhash,
// curtime, bits, ...).
// options:
//   - merkleRoot: precomputed 32-byte Buffer (internal order), OR
//   - txids: array of display-order txid hex strings (coinbase first) to
//     derive the merkle root from
//   - time, nonce, version: overrides for manual clicking/incrementing
export function buildHeader(template, options = {}) {
  const merkleRoot = options.merkleRoot ?? (options.txids && computeMerkleRoot(options.txids));
  if (!merkleRoot) {
    throw new Error(
      'buildHeader requires options.merkleRoot or options.txids ' +
        '(getblocktemplate does not include a ready-made coinbase txid — ' +
        'constructing the coinbase transaction is not yet implemented)'
    );
  }

  const version = options.version ?? template.version;
  const time = options.time ?? template.curtime;
  const nonce = options.nonce ?? 0;
  const prevHash = toInternalOrder(template.previousblockhash);
  const bits = toInternalOrder(template.bits);

  const header = Buffer.alloc(80);
  header.writeInt32LE(version, 0);
  prevHash.copy(header, 4);
  merkleRoot.copy(header, 36);
  header.writeUInt32LE(time, 68);
  bits.copy(header, 72);
  header.writeUInt32LE(nonce >>> 0, 76);
  return header;
}
