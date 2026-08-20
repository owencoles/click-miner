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

let idCounter = 0;

// socks5h scheme: resolve the hostname *through* the proxy, required for
// .onion addresses since they aren't resolvable by normal DNS.
const TOR_SOCKS_PROXY = process.env.TOR_SOCKS_PROXY || 'socks5h://127.0.0.1:9050';
let torAgent = null;

function isOnionHost(host) {
  return typeof host === 'string' && host.toLowerCase().endsWith('.onion');
}

function resolveAuth(settings) {
  if (settings.cookiePath) {
    const cookie = fs.readFileSync(settings.cookiePath, 'utf8').trim();
    const [user, password] = cookie.split(':');
    return { user, password };
  }
  return { user: settings.username, password: settings.password };
}

export function rpcCall(method, params = []) {
  const settings = getSettings();
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
        } catch (err) {
          reject(Object.assign(new Error(`Invalid RPC response (status ${res.statusCode}): ${data.slice(0, 200)}`), { statusCode: 502 }));
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
