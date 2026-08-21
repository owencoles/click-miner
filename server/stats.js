// Lifetime hash-attempt counter — persisted to disk (same DATA_DIR as
// settings) so it survives page reloads, template refreshes, and full
// container restarts. This is deliberately separate from any one mining
// candidate: candidates come and go with each template refresh, but the
// "how many hashes have you ever submitted" count should not reset with
// them.

import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
const STATS_PATH = path.join(DATA_DIR, 'stats.json');

let cache = null;

function load() {
  if (cache) return cache;
  try {
    const raw = fs.readFileSync(STATS_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    cache = { totalHashes: Number.isInteger(parsed.totalHashes) ? parsed.totalHashes : 0 };
  } catch {
    cache = { totalHashes: 0 };
  }
  return cache;
}

function save() {
  fs.mkdirSync(DATA_DIR, { recursive: true, mode: 0o700 });
  fs.writeFileSync(STATS_PATH, JSON.stringify(cache, null, 2), { mode: 0o600 });
}

export function getStats() {
  return { ...load() };
}

export function incrementHashes() {
  load();
  cache.totalHashes += 1;
  save();
  return cache.totalHashes;
}
