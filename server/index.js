// HTTP + WebSocket server. Serves /public and exposes the API routes the
// frontend uses to read/save settings, fetch a mining candidate (template +
// coinbase + header), hash it, and submit a found block. A WebSocket at
// /ws pushes status/candidate/hash events so every connected tab stays
// live without polling, and so a found block or a new network tip shows
// up immediately even in tabs that aren't the one clicking.

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

import { getSettings, saveSettings, tighten } from './settings.js';
import { getStats, incrementHashes } from './stats.js';
import { getBlockTemplate, submitBlock, getBlockchainInfo } from './rpc.js';
import { decodeAddress } from './address.js';
import { buildCoinbaseTransaction, varInt } from './coinbase.js';
import { computeMerkleRoot, buildHeader } from './header.js';
import { sha256d, toDisplayHex, bitsToTarget, meetsTarget, countLeadingZeroBits } from './hash.js';
import { isPrivateHost, hostnameFromHeader } from './net-guard.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;
// Loopback by default: the API is unauthenticated by design (it assumes
// whoever reaches the port is the operator), so it must not be published
// to the LAN unless someone opts in deliberately.
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.webmanifest': 'application/manifest+json',
};

// ---------------------------------------------------------------------
// Request origin guard
//
// Click Miner has no login — it assumes whoever reaches the port is the
// operator. That assumption holds for curl on the same box; it does not
// hold in a browser, where any page the user visits can send requests to
// localhost. Two checks restore it:
//
//   Origin must match Host. A cross-site request carries the attacker's
//   Origin and fails; the app's own fetches carry a matching one and
//   pass; non-browser clients send no Origin at all and are unaffected.
//   This is what stops a visited page from rewriting the payout address.
//
//   Host must be a private name. DNS rebinding defeats the Origin check
//   by making Origin and Host *both* the attacker's domain, so the name
//   itself has to be rejected — a public FQDN is never how you reach your
//   own node. ALLOWED_HOSTS extends this for setups that need it (a
//   Tailscale *.ts.net MagicDNS name, say).
// ---------------------------------------------------------------------

const EXTRA_ALLOWED_HOSTS = new Set(
  (process.env.ALLOWED_HOSTS || '')
    .split(',')
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
);
const ORIGIN_CHECK_DISABLED = process.env.DISABLE_ORIGIN_CHECK === '1';

function hostAllowed(req) {
  const hostHeader = String(req.headers.host || '');
  if (EXTRA_ALLOWED_HOSTS.has(hostHeader.toLowerCase())) return true;
  const hostname = hostnameFromHeader(hostHeader);
  if (!hostname) return false;
  if (EXTRA_ALLOWED_HOSTS.has(hostname.toLowerCase())) return true;
  return isPrivateHost(hostname);
}

function originAllowed(req) {
  const origin = req.headers.origin;
  // No Origin means no browser sent this — curl, a script, a health
  // check. Those can't be driven by a malicious page, so there's nothing
  // for this check to protect against.
  if (!origin) return true;
  if (origin === 'null') return false; // sandboxed iframe / opaque origin
  let parsed;
  try {
    parsed = new URL(origin);
  } catch {
    return false;
  }
  return parsed.host.toLowerCase() === String(req.headers.host || '').toLowerCase();
}

// Returns null when the request may proceed, or a { status, error } to
// send back. Shared by the HTTP API and the WebSocket upgrade.
function checkRequestOrigin(req) {
  if (ORIGIN_CHECK_DISABLED) return null;
  if (!hostAllowed(req)) {
    return {
      status: 403,
      error:
        'refused: unrecognized Host header. Reach Click Miner at localhost, a LAN/tailnet ' +
        'address, or a .local/.onion name — or set ALLOWED_HOSTS to permit this hostname.',
    };
  }
  if (!originAllowed(req)) {
    return { status: 403, error: 'refused: cross-origin request' };
  }
  return null;
}

// ---------------------------------------------------------------------
// WebSocket broadcast — every connected client (tab, phone, whatever)
// gets the same events, since Click Miner has one shared mining session
// rather than per-connection state.
// ---------------------------------------------------------------------

const wsClients = new Set();

function broadcast(type, payload) {
  const message = JSON.stringify({ type, payload });
  for (const ws of wsClients) {
    if (ws.readyState === ws.OPEN) {
      ws.send(message);
    }
  }
}

// ---------------------------------------------------------------------
// Mining candidate state — a single in-memory "session" shared by every
// client. Click Miner is a single-node-operator toy, not a multi-tenant
// service, so a module-level variable is sufficient (no per-user state).
// ---------------------------------------------------------------------

let candidate = null;

// getblocktemplate is one of bitcoind's more expensive calls, so builds
// are coalesced (concurrent callers share one in-flight build) and rate
// limited (a cooldown between builds). A template barely changes within
// a few seconds, so neither constrains the UI.
const CANDIDATE_REFRESH_COOLDOWN_MS = 3_000;
let lastBuildAt = 0;
let inFlightBuild = null;

async function buildCandidate() {
  const settings = getSettings();
  if (!settings.payoutAddress) {
    const err = new Error('payout address is not configured — set one on the settings screen first');
    err.statusCode = 400;
    throw err;
  }

  const { scriptPubKey, type: payoutType } = decodeAddress(settings.payoutAddress);
  const template = await getBlockTemplate();

  const coinbase = buildCoinbaseTransaction(template, scriptPubKey);
  const txids = [coinbase.txid, ...template.transactions.map((tx) => tx.txid)];
  const merkleRoot = computeMerkleRoot(txids);

  const next = {
    templateFields: {
      version: template.version,
      previousblockhash: template.previousblockhash,
      bits: template.bits,
    },
    height: template.height,
    target: bitsToTarget(template.bits),
    merkleRoot,
    coinbase,
    otherTransactions: template.transactions.map((tx) => ({ txid: tx.txid, data: tx.data })),
    payoutAddress: settings.payoutAddress,
    payoutType,
    time: template.curtime,
    nonce: 0,
    fetchedAt: Date.now(),
  };

  // Serialize before publishing. formatCandidate() builds the 80-byte
  // header, which is where a malformed template actually fails — and if
  // a candidate that can't be serialized becomes the live one, every
  // later read of it throws, including the read in the WebSocket
  // connection handler below. Failing here leaves the previous good
  // candidate in place instead.
  const formatted = formatCandidate(next);

  candidate = next;
  lastBuildAt = Date.now();
  broadcast('candidate', formatted);
  return candidate;
}

function buildCandidateShared() {
  if (!inFlightBuild) {
    inFlightBuild = buildCandidate().finally(() => {
      inFlightBuild = null;
    });
  }
  return inFlightBuild;
}

// Explicit user-driven refresh: shares an in-flight build if there is
// one, otherwise enforces the cooldown.
async function requestRefresh() {
  if (inFlightBuild) return inFlightBuild;
  const elapsed = Date.now() - lastBuildAt;
  if (elapsed < CANDIDATE_REFRESH_COOLDOWN_MS) {
    const wait = Math.ceil((CANDIDATE_REFRESH_COOLDOWN_MS - elapsed) / 1000);
    const err = new Error(`template was just refreshed — try again in ${wait}s`);
    err.statusCode = 429;
    throw err;
  }
  return buildCandidateShared();
}

async function getOrCreateCandidate() {
  if (!candidate) {
    await buildCandidateShared();
  }
  return candidate;
}

function currentHeader(c = candidate) {
  return buildHeader(c.templateFields, {
    merkleRoot: c.merkleRoot,
    time: c.time,
    nonce: c.nonce,
  });
}

function formatCandidate(c = candidate) {
  const header = currentHeader(c);
  return {
    height: c.height,
    version: '0x' + (c.templateFields.version >>> 0).toString(16).padStart(8, '0'),
    previousBlockHash: c.templateFields.previousblockhash,
    merkleRoot: toDisplayHex(c.merkleRoot),
    bits: c.templateFields.bits,
    target: c.target.toString(16).padStart(64, '0'),
    time: c.time,
    nonce: c.nonce,
    attempts: getStats().totalHashes,
    headerHex: header.toString('hex'),
    coinbase: {
      txid: c.coinbase.txid,
      valueSats: c.coinbase.value,
    },
    payoutAddress: c.payoutAddress,
    payoutType: c.payoutType,
    transactionCount: 1 + c.otherTransactions.length,
    fetchedAt: c.fetchedAt,
  };
}

async function computeStatus() {
  const settings = getSettings();
  let node = null;
  let nodeError = null;
  try {
    const info = await getBlockchainInfo();
    node = { chain: info.chain, blocks: info.blocks, headers: info.headers, difficulty: info.difficulty };
  } catch (err) {
    nodeError = err.message;
  }
  return { payoutConfigured: Boolean(settings.payoutAddress), node, nodeError };
}

function serializeBlockForSubmission() {
  const header = currentHeader();
  const txCount = varInt(1 + candidate.otherTransactions.length);
  const parts = [header, txCount, candidate.coinbase.rawTx];
  for (const tx of candidate.otherTransactions) {
    parts.push(Buffer.from(tx.data, 'hex'));
  }
  return Buffer.concat(parts).toString('hex');
}

// A manual click, or even a fast auto-click loop, should never approach
// real hashrate — this is a floor under the frontend's own throttling, not
// the primary rate control. Tracked per client so one busy tab doesn't
// throttle everyone else on the shared session.
const MIN_HASH_INTERVAL_MS = 50;
const RATE_KEY_TTL_MS = 60_000;
const lastHashByClient = new Map();

function checkHashRate(req) {
  const key = req.socket.remoteAddress || 'unknown';
  const now = Date.now();

  if (lastHashByClient.size > 1000) {
    for (const [client, at] of lastHashByClient) {
      if (now - at > RATE_KEY_TTL_MS) lastHashByClient.delete(client);
    }
  }

  const last = lastHashByClient.get(key) || 0;
  if (now - last < MIN_HASH_INTERVAL_MS) {
    const err = new Error('hashing too fast — Click Miner is intentionally non-competitive');
    err.statusCode = 429;
    throw err;
  }
  lastHashByClient.set(key, now);
}

async function handleHash(req, body) {
  await getOrCreateCandidate();
  checkHashRate(req);

  candidate.nonce = Number.isInteger(body.nonce)
    ? body.nonce >>> 0
    : (candidate.nonce + 1) >>> 0;
  if (Number.isInteger(body.time)) {
    candidate.time = body.time >>> 0;
  }
  const totalHashes = incrementHashes();

  const header = currentHeader();
  const hash = sha256d(header);
  const success = meetsTarget(hash, candidate.target);

  const result = {
    nonce: candidate.nonce,
    time: candidate.time,
    attempts: totalHashes,
    headerHex: header.toString('hex'),
    hash: toDisplayHex(hash),
    leadingZeroBits: countLeadingZeroBits(hash),
    meetsTarget: success,
  };

  if (success) {
    const blockHex = serializeBlockForSubmission();
    try {
      const submitResult = await submitBlock(blockHex);
      // bitcoind returns null on success, or a string reject-reason on failure.
      result.submit = { accepted: submitResult === null, detail: submitResult };
    } catch (err) {
      result.submit = { accepted: false, detail: err.message };
    }
  }

  broadcast('hash', result);
  return result;
}

// ---------------------------------------------------------------------
// HTTP plumbing
// ---------------------------------------------------------------------

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    // A cross-site form post can only ever be text/plain, multipart, or
    // urlencoded — application/json from another origin requires a
    // preflight the browser won't get past. Requiring it here is a second
    // lock on the same door as the Origin check.
    const contentType = String(req.headers['content-type'] || '');
    if (contentType && !contentType.toLowerCase().startsWith('application/json')) {
      reject(Object.assign(new Error('Content-Type must be application/json'), { statusCode: 415 }));
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
      if (raw.length > 1_000_000) {
        reject(Object.assign(new Error('request body too large'), { statusCode: 413 }));
        req.destroy();
      }
    });
    req.on('end', () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(Object.assign(new Error('invalid JSON body'), { statusCode: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// Everything this app serves is same-origin and self-contained: no CDN,
// no remote fonts, no third-party anything. That makes a tight CSP free.
const SECURITY_HEADERS = {
  'Content-Security-Policy':
    // script-src is the directive that matters here and stays strict.
    // style-src needs 'unsafe-inline' because the target-progress bar
    // sets its width from JS; with every dynamic value rendered through
    // textContent there is no injection point for that to widen.
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "connect-src 'self' ws: wss:; font-src 'self'; object-src 'none'; " +
    "base-uri 'none'; form-action 'none'; frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

function maskSettings(settings) {
  const { password, ...rest } = settings;
  return { ...rest, hasPassword: Boolean(password) };
}

const routes = {
  'GET /api/settings': async () => {
    return { status: 200, body: maskSettings(getSettings()) };
  },
  'POST /api/settings': async (req) => {
    const body = await readJsonBody(req);
    let saved;
    try {
      saved = saveSettings(body);
    } catch (err) {
      err.statusCode = err.statusCode || 400;
      throw err;
    }
    return { status: 200, body: maskSettings(saved) };
  },
  'GET /api/status': async () => {
    return { status: 200, body: await computeStatus() };
  },
  'GET /api/candidate': async () => {
    await getOrCreateCandidate();
    return { status: 200, body: formatCandidate() };
  },
  'POST /api/candidate/refresh': async () => {
    await requestRefresh();
    return { status: 200, body: formatCandidate() };
  },
  'POST /api/hash': async (req) => {
    const body = await readJsonBody(req);
    const result = await handleHash(req, body);
    return { status: 200, body: result };
  },
};

async function handleApi(req, res, pathname) {
  const refusal = checkRequestOrigin(req);
  if (refusal) {
    sendJson(res, refusal.status, { error: refusal.error });
    return;
  }

  const key = `${req.method} ${pathname}`;
  const handler = routes[key];
  if (!handler) {
    sendJson(res, 404, { error: 'not found' });
    return;
  }
  try {
    const { status, body } = await handler(req);
    sendJson(res, status, body);
  } catch (err) {
    sendJson(res, err.statusCode || 500, { error: err.message });
  }
}

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));

  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, SECURITY_HEADERS);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
    });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const pathname = req.url.split('?')[0];
  if (pathname.startsWith('/api/')) {
    handleApi(req, res, pathname);
    return;
  }
  serveStatic(req, res);
});

// ---------------------------------------------------------------------
// WebSocket server — pushes 'status', 'candidate', and 'hash' events to
// every connected client. A new connection is synced immediately with
// whatever state we already have, rather than waiting for the next
// periodic broadcast.
//
// WebSockets are exempt from the same-origin policy, so without
// verifyClient any page the user visits could connect and read the
// broadcast stream — payout address included. It gets the same Host and
// Origin checks as the HTTP API.
// ---------------------------------------------------------------------

const wss = new WebSocketServer({
  server,
  path: '/ws',
  verifyClient: ({ req }, done) => {
    const refusal = checkRequestOrigin(req);
    if (refusal) {
      done(false, refusal.status, refusal.error);
      return;
    }
    done(true);
  },
});

wss.on('connection', async (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));

  // This handler is async, so anything thrown here becomes an unhandled
  // rejection rather than something the ws library catches — which would
  // take the whole process down. Nothing in here is worth a crash.
  try {
    ws.send(JSON.stringify({ type: 'status', payload: await computeStatus() }));
    if (candidate) {
      ws.send(JSON.stringify({ type: 'candidate', payload: formatCandidate() }));
    }
  } catch (err) {
    console.error('websocket initial sync failed:', err.message);
  }
});

// Periodically checks node status (for the connection indicator) and, if
// the chain tip has advanced past our candidate's height, rebuilds the
// candidate automatically — mining against a template for a block that's
// already been superseded would be pointless even for a toy miner.
const STATUS_POLL_INTERVAL_MS = Number(process.env.STATUS_POLL_INTERVAL_MS) || 15_000;
let lastKnownHeight = null;

async function pollStatus() {
  const status = await computeStatus();
  broadcast('status', status);

  if (status.node && status.payoutConfigured) {
    if (lastKnownHeight !== null && status.node.blocks > lastKnownHeight && candidate) {
      try {
        await buildCandidateShared();
      } catch (err) {
        console.error('auto-refresh on new block failed:', err.message);
      }
    }
    lastKnownHeight = status.node.blocks;
  }
}

setInterval(() => {
  pollStatus().catch((err) => console.error('status poll failed:', err.message));
}, STATUS_POLL_INTERVAL_MS);

// Last line of defence. A miner that stops mining because some async path
// threw is worse than one that logs and keeps going, and an unhandled
// rejection is a hard exit by default on Node 15+.
process.on('unhandledRejection', (reason) => {
  console.error('unhandled rejection:', reason instanceof Error ? reason.message : reason);
});
process.on('uncaughtException', (err) => {
  console.error('uncaught exception:', err.message);
});

// Re-apply 0600/0700 to anything an earlier version left world-readable.
tighten();

server.listen(PORT, HOST, () => {
  const shown = HOST === '0.0.0.0' || HOST === '::' ? 'localhost' : HOST;
  console.log(`Click Miner listening on http://${shown}:${PORT}`);
  if (HOST === '0.0.0.0' || HOST === '::') {
    console.log(
      'Bound to all interfaces. Inside a container that is expected — the exposure ' +
        'boundary is your port mapping. On a host, note the API is unauthenticated: ' +
        'anyone who can reach this port can change your payout address.'
    );
  }
});
