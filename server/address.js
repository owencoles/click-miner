// Decodes a Bitcoin payout address (any standard type) into the raw
// scriptPubKey bytes needed for a coinbase transaction output.
//
// This module only ever touches public addresses, never private keys —
// per the project's non-goal on key management, it has no way to sign or
// spend anything. Checksum/curve-sensitive decoding (base58check,
// bech32/bech32m) is delegated to small, widely-used packages rather than
// hand-rolled, since a subtle bug here would misdirect a mined block reward.

import bs58check from 'bs58check';
import { bech32, bech32m } from 'bech32';

const BASE58_VERSIONS = {
  0x00: { type: 'p2pkh', network: 'mainnet' },
  0x05: { type: 'p2sh', network: 'mainnet' },
  0x6f: { type: 'p2pkh', network: 'testnet' }, // shared by testnet/regtest/signet
  0xc4: { type: 'p2sh', network: 'testnet' },
};

const BECH32_HRPS = {
  bc: 'mainnet',
  tb: 'testnet',
  bcrt: 'regtest',
};

function opPush(bytes) {
  if (bytes.length >= 0x4c) {
    throw new Error('push data too large for a direct push opcode');
  }
  return Buffer.concat([Buffer.from([bytes.length]), bytes]);
}

function decodeBase58(address) {
  const payload = bs58check.decode(address);
  const version = payload[0];
  const hash = Buffer.from(payload.subarray(1));
  const info = BASE58_VERSIONS[version];
  if (!info) {
    throw new Error(`unrecognized base58 address version byte 0x${version.toString(16)}`);
  }
  if (hash.length !== 20) {
    throw new Error(`unexpected base58 address payload length: ${hash.length} bytes`);
  }

  const scriptPubKey =
    info.type === 'p2pkh'
      ? Buffer.concat([Buffer.from([0x76, 0xa9]), opPush(hash), Buffer.from([0x88, 0xac])])
      : Buffer.concat([Buffer.from([0xa9]), opPush(hash), Buffer.from([0x87])]);

  return { type: info.type, network: info.network, scriptPubKey };
}

function decodeSegwit(address) {
  let decoded;
  let variant;
  try {
    decoded = bech32.decode(address);
    variant = 'bech32';
  } catch {
    decoded = bech32m.decode(address);
    variant = 'bech32m';
  }

  const network = BECH32_HRPS[decoded.prefix];
  if (!network) {
    throw new Error(`unrecognized bech32 human-readable prefix "${decoded.prefix}"`);
  }

  const [version, ...programWords] = decoded.words;
  const program = Buffer.from(bech32.fromWords(programWords));

  const expectedVariant = version === 0 ? 'bech32' : 'bech32m';
  if (variant !== expectedVariant) {
    throw new Error(
      `witness v${version} address must be encoded as ${expectedVariant}, got ${variant}`
    );
  }
  if (version > 16) {
    throw new Error(`invalid witness version ${version}`);
  }
  if (program.length < 2 || program.length > 40) {
    throw new Error(`invalid witness program length ${program.length}`);
  }
  if (version === 0 && program.length !== 20 && program.length !== 32) {
    throw new Error(`invalid witness v0 program length ${program.length} (expected 20 or 32)`);
  }

  const versionOpcode = version === 0 ? 0x00 : 0x50 + version;
  const scriptPubKey = Buffer.concat([Buffer.from([versionOpcode]), opPush(program)]);

  const type =
    version === 0 && program.length === 20
      ? 'p2wpkh'
      : version === 0 && program.length === 32
        ? 'p2wsh'
        : version === 1 && program.length === 32
          ? 'p2tr'
          : `witness_v${version}`;

  return { type, network, scriptPubKey };
}

// Returns { type, network, scriptPubKey } or throws with a message safe to
// show the user (no address data beyond what they typed is echoed back).
export function decodeAddress(address) {
  if (typeof address !== 'string' || address.trim().length === 0) {
    throw new Error('payout address is required');
  }

  try {
    return decodeBase58(address);
  } catch {
    try {
      return decodeSegwit(address);
    } catch (segwitError) {
      throw new Error(`not a valid Bitcoin address (${segwitError.message})`);
    }
  }
}
