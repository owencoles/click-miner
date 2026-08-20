// Reads/writes RPC connection settings (host, port, username, password or
// cookie auth path) and the payout address block rewards are sent to. On
// Umbrel/Start9 the RPC fields are pre-filled from platform-injected env
// vars; the payout address is always entered by the user and persisted to
// a local JSON config file (never a private key — see server/address.js).

import fs from 'node:fs';
import path from 'node:path';
import { decodeAddress } from './address.js';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const CONFIG_PATH = path.join(DATA_DIR, 'config.json');

const DEFAULTS = {
  host: '127.0.0.1',
  port: 8332,
  username: '',
  password: '',
  cookiePath: '',
  payoutAddress: '',
};

function readConfigFile() {
  try {
    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function envOverrides() {
  const env = {};
  if (process.env.RPC_HOST) env.host = process.env.RPC_HOST;
  if (process.env.RPC_PORT) env.port = Number(process.env.RPC_PORT);
  if (process.env.RPC_USER) env.username = process.env.RPC_USER;
  if (process.env.RPC_PASSWORD) env.password = process.env.RPC_PASSWORD;
  if (process.env.RPC_COOKIE_PATH) env.cookiePath = process.env.RPC_COOKIE_PATH;
  if (process.env.PAYOUT_ADDRESS) env.payoutAddress = process.env.PAYOUT_ADDRESS;
  return env;
}

export function getSettings() {
  return { ...DEFAULTS, ...readConfigFile(), ...envOverrides() };
}

export function saveSettings(settings) {
  const current = readConfigFile();
  const next = {
    ...current,
    host: settings.host ?? current.host ?? DEFAULTS.host,
    port: settings.port ?? current.port ?? DEFAULTS.port,
    username: settings.username ?? current.username ?? DEFAULTS.username,
    password: settings.password ?? current.password ?? DEFAULTS.password,
    cookiePath: settings.cookiePath ?? current.cookiePath ?? DEFAULTS.cookiePath,
    payoutAddress: settings.payoutAddress ?? current.payoutAddress ?? DEFAULTS.payoutAddress,
  };

  if (next.payoutAddress) {
    // Throws with a user-facing message if the address is malformed —
    // better to reject at save time than silently mine toward an invalid
    // scriptPubKey.
    decodeAddress(next.payoutAddress);
  }

  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(next, null, 2));
  return getSettings();
}
