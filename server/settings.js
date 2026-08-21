// Reads/writes RPC connection settings (protocol, host, port, username,
// password) and the payout address block rewards are sent to. On
// Umbrel/Start9 the RPC fields are pre-filled from platform-injected env
// vars; the payout address is always entered by the user and persisted to
// a local JSON config file (never a private key — see server/address.js).
//
// Two things are deliberately NOT settable through the HTTP API:
//
//   - cookiePath, because it is a path this process will read and then
//     send the contents of to `host` as an HTTP Basic credential. Sourced
//     from RPC_COOKIE_PATH only, so a request that can write config can't
//     turn that into an arbitrary-file-read primitive.
//   - anything failing validate() below, so a malformed write can't
//     persist a config the app then refuses to start against.
//
// The config file holds the RPC password in plaintext, so it is written
// 0600 inside a 0700 directory, and existing files are re-tightened on
// every save (the `mode` option only applies to files being created).

import fs from 'node:fs';
import path from 'node:path';
import { decodeAddress } from './address.js';
import { isPrivateHost, isValidHostname } from './net-guard.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

// Escape hatch for the minority who genuinely run their node on a public
// address. Off by default: without it, `host` is confined to loopback,
// LAN, tailnet, and .onion (see server/net-guard.js).
const ALLOW_PUBLIC_RPC_HOST = process.env.ALLOW_PUBLIC_RPC_HOST === '1';

const DEFAULTS = {
  protocol: 'http',
  host: '127.0.0.1',
  port: 8332,
  username: '',
  password: '',
  payoutAddress: '',
};

function readConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function envOverrides() {
  const env = {};
  if (process.env.RPC_PROTOCOL) env.protocol = process.env.RPC_PROTOCOL;
  if (process.env.RPC_HOST) env.host = process.env.RPC_HOST;
  if (process.env.RPC_PORT) env.port = Number(process.env.RPC_PORT);
  if (process.env.RPC_USER) env.username = process.env.RPC_USER;
  if (process.env.RPC_PASSWORD) env.password = process.env.RPC_PASSWORD;
  if (process.env.PAYOUT_ADDRESS) env.payoutAddress = process.env.PAYOUT_ADDRESS;
  return env;
}

export function getSettings() {
  const merged = { ...DEFAULTS, ...readConfigFile(), ...envOverrides() };
  // Env-only, and forced after the spread so a stale or hand-edited
  // config.json can't reintroduce it. See the header note.
  merged.cookiePath = process.env.RPC_COOKIE_PATH || '';
  return merged;
}

// Throws with a user-facing message. Runs on every save so bad input is
// rejected at the boundary rather than surfacing later as an opaque
// failure from deep inside the HTTP client.
function validate(next) {
  if (next.protocol !== 'http' && next.protocol !== 'https') {
    throw new Error('RPC protocol must be "http" or "https"');
  }

  if (typeof next.host !== 'string' || !next.host.trim()) {
    throw new Error('RPC host is required');
  }
  if (!isValidHostname(next.host)) {
    throw new Error('RPC host must be a hostname, IP address, or .onion address');
  }
  if (!ALLOW_PUBLIC_RPC_HOST && !isPrivateHost(next.host)) {
    throw new Error(
      'RPC host must be on your own machine, LAN, tailnet, or Tor (.onion). ' +
        'To use a public address, restart with ALLOW_PUBLIC_RPC_HOST=1.'
    );
  }

  if (!Number.isInteger(next.port) || next.port < 1 || next.port > 65535) {
    throw new Error('RPC port must be a whole number between 1 and 65535');
  }

  if (typeof next.username !== 'string') throw new Error('RPC username must be text');
  if (typeof next.password !== 'string') throw new Error('RPC password must be text');
  if (next.username.length > 512 || next.password.length > 512) {
    throw new Error('RPC username and password must be under 512 characters');
  }

  if (typeof next.payoutAddress !== 'string') {
    throw new Error('payout address must be text');
  }
  if (next.payoutAddress) {
    // Throws with a user-facing message if the address is malformed —
    // better to reject at save time than silently mine toward an invalid
    // scriptPubKey.
    decodeAddress(next.payoutAddress);
  }
}

export function saveSettings(settings) {
  if (!settings || typeof settings !== 'object' || Array.isArray(settings)) {
    throw new Error('settings must be a JSON object');
  }
  const current = readConfigFile();

  const pick = (key) => settings[key] ?? current[key] ?? DEFAULTS[key];
  const next = {
    protocol: pick('protocol'),
    host: typeof pick('host') === 'string' ? pick('host').trim() : pick('host'),
    port: pick('port'),
    username: pick('username'),
    password: pick('password'),
    payoutAddress:
      typeof pick('payoutAddress') === 'string'
        ? pick('payoutAddress').trim()
        : pick('payoutAddress'),
  };

  validate(next);

  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2), { mode: 0o600 });
  tighten();
  return getSettings();
}

// Re-applies restrictive permissions to the data directory and the files
// in it. `mode` on writeFileSync only takes effect when the file is
// created, so configs written by an earlier version stay 0644 until they
// are chmod'ed explicitly — which is what this does, on every save and
// once at startup.
export function tighten() {
  try {
    fs.chmodSync(DATA_DIR, 0o700);
  } catch {
    // Directory may not exist yet, or be a mount point we don't own —
    // the file modes below are what actually protect the credentials.
  }
  for (const name of ['config.json', 'stats.json']) {
    try {
      fs.chmodSync(path.join(DATA_DIR, name), 0o600);
    } catch {
      // Not present yet, or not ours to chmod — nothing to tighten.
    }
  }
}
