// JSON-RPC client for the user's bitcoind. POSTs JSON-RPC requests over
// HTTP(S) using either user/password or cookie-file auth, per the
// connection settings from server/settings.js.

import http from 'node:http';
import https from 'node:https';
import fs from 'node:fs';
import { getSettings } from './settings.js';

let idCounter = 0;

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
  };

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
      reject(Object.assign(err, { statusCode: 502 }));
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
