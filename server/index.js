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

import { getSettings, saveSettings } from './settings.js';
import { getBlockTemplate, submitBlock, getBlockchainInfo } from './rpc.js';
import { decodeAddress } from './address.js';
import { buildCoinbaseTransaction, varInt } from './coinbase.js';
import { computeMerkleRoot, buildHeader } from './header.js';
import { sha256d, toDisplayHex, bitsToTarget, meetsTarget, countLeadingZeroBits } from './hash.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const PORT = process.env.PORT || 3000;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.ico': 'image/x-icon',
  '.png': 'image/png',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
};

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

  candidate = {
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
    attempts: 0,
    fetchedAt: Date.now(),
  };

  broadcast('candidate', formatCandidate());
  return candidate;
}

async function getOrCreateCandidate() {
  if (!candidate) {
    await buildCandidate();
  }
  return candidate;
}

function currentHeader() {
  return buildHeader(candidate.templateFields, {
    merkleRoot: candidate.merkleRoot,
    time: candidate.time,
    nonce: candidate.nonce,
  });
}

function formatCandidate() {
  const header = currentHeader();
  return {
    height: candidate.height,
    version: '0x' + (candidate.templateFields.version >>> 0).toString(16).padStart(8, '0'),
    previousBlockHash: candidate.templateFields.previousblockhash,
    merkleRoot: toDisplayHex(candidate.merkleRoot),
    bits: candidate.templateFields.bits,
    target: candidate.target.toString(16).padStart(64, '0'),
    time: candidate.time,
    nonce: candidate.nonce,
    attempts: candidate.attempts,
    headerHex: header.toString('hex'),
    coinbase: {
      txid: candidate.coinbase.txid,
      valueSats: candidate.coinbase.value,
    },
    payoutAddress: candidate.payoutAddress,
    payoutType: candidate.payoutType,
    transactionCount: 1 + candidate.otherTransactions.length,
    fetchedAt: candidate.fetchedAt,
  };
}

async function computeStatus() {
  const settings = getSettings();
  let node = null;
  let nodeError = null;
  try {
    const info = await getBlockchainInfo();
    node = { chain: info.chain, blocks: info.blocks, headers: info.headers };
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
// the primary rate control.
const MIN_HASH_INTERVAL_MS = 50;
let lastHashAt = 0;

async function handleHash(body) {
  await getOrCreateCandidate();

  const now = Date.now();
  if (now - lastHashAt < MIN_HASH_INTERVAL_MS) {
    const err = new Error('hashing too fast — Click Miner is intentionally non-competitive');
    err.statusCode = 429;
    throw err;
  }
  lastHashAt = now;

  candidate.nonce = Number.isInteger(body.nonce)
    ? body.nonce >>> 0
    : (candidate.nonce + 1) >>> 0;
  if (Number.isInteger(body.time)) {
    candidate.time = body.time >>> 0;
  }
  candidate.attempts += 1;

  const header = currentHeader();
  const hash = sha256d(header);
  const success = meetsTarget(hash, candidate.target);

  const result = {
    nonce: candidate.nonce,
    time: candidate.time,
    attempts: candidate.attempts,
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

function sendJson(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
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
      err.statusCode = 400;
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
    await buildCandidate();
    return { status: 200, body: formatCandidate() };
  },
  'POST /api/hash': async (req) => {
    const body = await readJsonBody(req);
    const result = await handleHash(body);
    return { status: 200, body: result };
  },
};

async function handleApi(req, res, pathname) {
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
  const urlPath = req.url === '/' ? '/index.html' : req.url;
  const filePath = path.join(PUBLIC_DIR, path.normalize(urlPath).replace(/^(\.\.[/\\])+/, ''));

  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain' });
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
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
// ---------------------------------------------------------------------

const wss = new WebSocketServer({ server, path: '/ws' });

wss.on('connection', async (ws) => {
  wsClients.add(ws);
  ws.on('close', () => wsClients.delete(ws));
  ws.on('error', () => wsClients.delete(ws));

  try {
    ws.send(JSON.stringify({ type: 'status', payload: await computeStatus() }));
  } catch {
    // best-effort — the periodic poll below will retry and broadcast
  }
  if (candidate) {
    ws.send(JSON.stringify({ type: 'candidate', payload: formatCandidate() }));
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
        await buildCandidate();
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

server.listen(PORT, () => {
  console.log(`Click Miner listening on http://localhost:${PORT}`);
});
