// JSON-RPC client for the user's bitcoind. POSTs JSON-RPC requests over
// HTTP(S) using either user/password or cookie-file auth, per the
// connection settings from server/settings.js. A .onion host is routed
// through the Tor client bundled in the Docker image (see
// docker/torrc, docker/docker-entrypoint.sh) via its local SOCKS5 proxy —
// this is Umbrel's supported path for external RPC access without
// exposing the raw RPC port on the LAN.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { SocksProxyAgent } from 'socks-proxy-agent';
import { getSettings } from './settings.js';
import { isPrivateHost, isValidHostname } from './net-guard.js';

let idCounter = 0;

// socks5h scheme: resolve the hostname *through* the proxy, required for
// .onion addresses since they aren't resolvable by normal DNS.
const TOR_SOCKS_PROXY = process.env.TOR_SOCKS_PROXY || 'socks5h://127.0.0.1:9050';
let torAgent = null;

function isOnionHost(host) {
  return typeof host === 'string' && host.toLowerCase().endsWith('.onion');
}

// cookiePath is env-only (see server/settings.js) — it can't be set by a
// request. The read is still wrapped so the failure reason never reaches
// the client: the raw fs error names the path and distinguishes ENOENT
// from EISDIR from EACCES, which is a filesystem oracle if it's echoed.
function resolveAuth(settings) {
  if (settings.cookiePath) {
    let cookie;
    try {
      cookie = fs.readFileSync(settings.cookiePath, 'utf8').trim();
    } catch (err) {
      console.error(`cookie file unreadable (${settings.cookiePath}):`, err.message);
      throw Object.assign(
        new Error('RPC cookie file could not be read — check RPC_COOKIE_PATH and its permissions'),
        { statusCode: 502 }
      );
    }
    const separator = cookie.indexOf(':');
    if (separator === -1) {
      throw Object.assign(
        new Error('RPC cookie file is malformed (expected "user:password")'),
        { statusCode: 502 }
      );
    }
    return { user: cookie.slice(0, separator), password: cookie.slice(separator + 1) };
  }
  return { user: settings.username, password: settings.password };
}

// Defence in depth behind settings.js's own validation: env vars bypass
// saveSettings entirely, and this is the last point before we actually
// open a socket to whatever `host` says.
function assertConnectionAllowed(settings) {
  if (!isValidHostname(settings.host)) {
    throw Object.assign(new Error('RPC host is not a valid hostname or IP address'), { statusCode: 400 });
  }
  if (process.env.ALLOW_PUBLIC_RPC_HOST !== '1' && !isPrivateHost(settings.host)) {
    throw Object.assign(
      new Error('RPC host is not on your machine, LAN, tailnet, or Tor — refusing to connect'),
      { statusCode: 400 }
    );
  }
  if (!Number.isInteger(settings.port) || settings.port < 1 || settings.port > 65535) {
    throw Object.assign(new Error('RPC port must be a whole number between 1 and 65535'), { statusCode: 400 });
  }
}

export function rpcCall(method, params = []) {
  const settings = getSettings();
  assertConnectionAllowed(settings);
  const { user, password } = resolveAuth(settings);

  const body = JSON.stringify({
    jsonrpc: '1.0',
    id: `click-miner-${++idCounter}`,
    method,
    params,
  });

  const transport = settings.protocol === 'https' ? https : http;
  const useTor = isOnionHost(settings.host);

  const options = {
    hostname: settings.host,
    port: settings.port,
    path: '/',
    method: 'POST',
    auth: `${user}:${password}`,
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(body),
    },
    // Onion circuits can be slow to build, especially right after Tor
    // starts — give those more room than a direct connection.
    timeout: useTor ? 45_000 : 15_000,
  };

  if (useTor) {
    if (!torAgent) {
      torAgent = new SocksProxyAgent(TOR_SOCKS_PROXY);
    }
    options.agent = torAgent;
  }

  return new Promise((resolve, reject) => {
    const req = transport.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => {
        data += chunk;
      });
      res.on('end', () => {
        let parsed;
        try {
          parsed = JSON.parse(data);
        } catch {
          // The body is whatever host:port actually returned. Logging it
          // locally is useful; returning it would turn a misconfigured
          // host into a port scanner that reports back what it found.
          console.error(`non-JSON RPC response (status ${res.statusCode}):`, data.slice(0, 200));
          reject(Object.assign(
            new Error(`RPC host returned a non-JSON response (HTTP ${res.statusCode}) — check the host, port, and credentials`),
            { statusCode: 502 }
          ));
          return;
        }
        if (parsed.error) {
          reject(Object.assign(new Error(`RPC error: ${parsed.error.message || JSON.stringify(parsed.error)}`), { statusCode: 502 }));
          return;
        }
        resolve(parsed.result);
      });
    });

    req.on('error', (err) => {
      if (useTor) {
        err.message = `${err.message} (connecting over Tor — if the container just started, the bundled Tor client may still be bootstrapping; this can take up to a minute)`;
      }
      reject(Object.assign(err, { statusCode: 502 }));
    });
    req.on('timeout', () => {
      req.destroy(new Error(useTor ? 'RPC request timed out over Tor (circuit may still be building)' : 'RPC request timed out'));
    });
    req.write(body);
    req.end();
  });
}

export function getBlockTemplate(rules = ['segwit']) {
  return rpcCall('getblocktemplate', [{ rules }]);
}

export function submitBlock(blockHex) {
  return rpcCall('submitblock', [blockHex]);
}

export function getBlockchainInfo() {
  return rpcCall('getblockchaininfo');
}
