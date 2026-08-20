// Click Miner frontend: settings form, live header-field rendering, the
// click/auto-click loop against the /api/* routes, and a WebSocket client
// that keeps every connected tab in sync (status, candidate, and hash
// events) without polling.

const AUTOCLICK_INTERVAL_MS = 600; // slow & capped — for fun, never competitive
const WS_RECONNECT_DELAY_MS = 3000;

const el = (id) => document.getElementById(id);

const dom = {
  liveIndicator: el('live-indicator'),
  statusLed: el('status-led'),
  statusText: el('status-text'),
  hitCounter: el('hit-counter'),

  settingsToggle: el('settings-toggle'),
  settingsBody: el('settings-body'),
  settingsForm: el('settings-form'),
  settingsMessage: el('settings-message'),
  inputHost: el('input-host'),
  inputPort: el('input-port'),
  inputUsername: el('input-username'),
  inputPassword: el('input-password'),
  inputCookiePath: el('input-cookie-path'),
  inputPayoutAddress: el('input-payout-address'),

  fieldHeight: el('field-height'),
  fieldVersion: el('field-version'),
  fieldPrevhash: el('field-prevhash'),
  fieldMerkleroot: el('field-merkleroot'),
  fieldTime: el('field-time'),
  fieldBits: el('field-bits'),
  fieldNonce: el('field-nonce'),
  fieldCoinbaseValue: el('field-coinbase-value'),
  fieldHeaderHex: el('field-header-hex'),
  refreshButton: el('refresh-button'),
  candidateMessage: el('candidate-message'),

  targetBarFill: el('target-bar-fill'),
  targetBarCaption: el('target-bar-caption'),
  lastHash: el('last-hash'),
  mineButton: el('mine-button'),
  autoclickCheckbox: el('autoclick-checkbox'),
  successBanner: el('success-banner'),
  successDetail: el('success-detail'),
  logScreen: el('log-screen'),
};

let candidate = null;
let targetLeadingZeroBits = 0;
let autoclickTimer = null;
let lastAppliedAttempts = 0;

// ---------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------

async function api(method, path, body) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `request failed (${res.status})`);
    err.statusCode = res.status;
    throw err;
  }
  return data;
}

function hexLeadingZeroBits(hex) {
  let bits = 0;
  for (const ch of hex) {
    const n = parseInt(ch, 16);
    if (n === 0) {
      bits += 4;
      continue;
    }
    bits += 4 - n.toString(2).length;
    break;
  }
  return bits;
}

function formatCounter(n) {
  return String(n).padStart(7, '0');
}

function logLine(text, isHit) {
  const line = document.createElement('div');
  line.className = isHit ? 'log-line hit' : 'log-line';
  line.textContent = text;
  dom.logScreen.prepend(line);
  while (dom.logScreen.childNodes.length > 200) {
    dom.logScreen.removeChild(dom.logScreen.lastChild);
  }
}

function setMessage(elNode, text, kind) {
  elNode.textContent = text || '';
  elNode.className = 'inline-message' + (kind ? ' ' + kind : '');
}

// ---------------------------------------------------------------------
// settings
// ---------------------------------------------------------------------

async function loadSettings() {
  const settings = await api('GET', '/api/settings');
  dom.inputHost.value = settings.host || '';
  dom.inputPort.value = settings.port || '';
  dom.inputUsername.value = settings.username || '';
  dom.inputPassword.value = '';
  dom.inputPassword.placeholder = settings.hasPassword ? '(unchanged)' : '';
  dom.inputCookiePath.value = settings.cookiePath || '';
  dom.inputPayoutAddress.value = settings.payoutAddress || '';
  return settings;
}

dom.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(dom.settingsMessage, 'saving…');

  const body = {
    host: dom.inputHost.value.trim(),
    port: dom.inputPort.value ? Number(dom.inputPort.value) : undefined,
    username: dom.inputUsername.value,
    cookiePath: dom.inputCookiePath.value.trim(),
    payoutAddress: dom.inputPayoutAddress.value.trim(),
  };
  if (dom.inputPassword.value) {
    body.password = dom.inputPassword.value;
  }

  try {
    await api('POST', '/api/settings', body);
    setMessage(dom.settingsMessage, '✓ saved', 'ok');
    dom.inputPassword.value = '';
    await refreshStatus();
    await loadCandidate();
  } catch (err) {
    setMessage(dom.settingsMessage, '✗ ' + err.message, 'error');
  }
});

dom.settingsToggle.addEventListener('click', () => {
  const hidden = dom.settingsBody.classList.toggle('hidden');
  dom.settingsToggle.textContent = hidden ? '▢' : '▁';
});

// ---------------------------------------------------------------------
// status
// ---------------------------------------------------------------------

function applyStatus(status) {
  if (status.node) {
    dom.statusLed.className = 'led ok';
    dom.statusText.textContent = `connected · ${status.node.chain} · block ${status.node.blocks}`;
  } else {
    dom.statusLed.className = 'led error';
    dom.statusText.textContent = `node unreachable: ${status.nodeError || 'unknown error'}`;
  }
  if (!status.payoutConfigured) {
    dom.settingsBody.classList.remove('hidden');
    dom.settingsToggle.textContent = '▁';
  }
}

async function refreshStatus() {
  dom.statusLed.className = 'led pending';
  dom.statusText.textContent = 'checking connection…';
  try {
    const status = await api('GET', '/api/status');
    applyStatus(status);
    return status;
  } catch (err) {
    dom.statusLed.className = 'led error';
    dom.statusText.textContent = 'status check failed: ' + err.message;
    return null;
  }
}

// ---------------------------------------------------------------------
// mining candidate
// ---------------------------------------------------------------------

function renderCandidate() {
  if (!candidate) return;
  dom.fieldHeight.textContent = candidate.height;
  dom.fieldVersion.textContent = candidate.version;
  dom.fieldPrevhash.textContent = candidate.previousBlockHash;
  dom.fieldMerkleroot.textContent = candidate.merkleRoot;
  dom.fieldTime.textContent = `${candidate.time} (${new Date(candidate.time * 1000).toISOString()})`;
  dom.fieldBits.textContent = candidate.bits;
  dom.fieldNonce.textContent = candidate.nonce;
  dom.fieldCoinbaseValue.textContent = `${(candidate.coinbase.valueSats / 1e8).toFixed(8)} BTC → ${candidate.payoutAddress} (${candidate.payoutType})`;
  dom.fieldHeaderHex.textContent = candidate.headerHex;
  dom.hitCounter.textContent = formatCounter(candidate.attempts);

  targetLeadingZeroBits = hexLeadingZeroBits(candidate.target);
}

// A fresh candidate (new template, new coinbase) resets the attempt
// counter server-side too, so the hash-result dedupe guard needs to reset
// with it — otherwise a lower attempts count from the new candidate would
// look like a stale, already-applied result and get silently dropped.
function applyCandidate(payload) {
  candidate = payload;
  lastAppliedAttempts = payload.attempts;
  setMessage(dom.candidateMessage, '', '');
  renderCandidate();
  dom.successBanner.classList.add('hidden');
}

async function loadCandidate() {
  try {
    applyCandidate(await api('GET', '/api/candidate'));
  } catch (err) {
    setMessage(dom.candidateMessage, err.message, 'error');
  }
}

dom.refreshButton.addEventListener('click', async () => {
  setMessage(dom.candidateMessage, 'fetching fresh template…');
  try {
    applyCandidate(await api('POST', '/api/candidate/refresh'));
    setMessage(dom.candidateMessage, '✓ refreshed', 'ok');
  } catch (err) {
    setMessage(dom.candidateMessage, err.message, 'error');
  }
});

// ---------------------------------------------------------------------
// mining (click / auto-click)
// ---------------------------------------------------------------------

// A clicking tab gets the result twice: once as the direct HTTP response,
// once again as the WebSocket broadcast every client receives. Whichever
// arrives first wins; the second is a no-op, keyed on the strictly
// increasing attempts counter so it works regardless of arrival order.
function applyHashResult(result) {
  if (result.attempts <= lastAppliedAttempts) return;
  lastAppliedAttempts = result.attempts;

  if (candidate) {
    candidate.nonce = result.nonce;
    candidate.time = result.time;
    candidate.attempts = result.attempts;
    candidate.headerHex = result.headerHex;
  }
  dom.fieldNonce.textContent = result.nonce;
  dom.fieldHeaderHex.textContent = result.headerHex;
  dom.hitCounter.textContent = formatCounter(result.attempts);

  dom.lastHash.textContent = result.hash;

  const pct = targetLeadingZeroBits > 0
    ? Math.min(100, (result.leadingZeroBits / targetLeadingZeroBits) * 100)
    : 0;
  dom.targetBarFill.style.width = pct + '%';
  dom.targetBarCaption.textContent = `${result.leadingZeroBits} / ${targetLeadingZeroBits} bits`;

  logLine(`#${result.attempts} nonce=${result.nonce} → ${result.hash.slice(0, 24)}… (${result.leadingZeroBits} zero bits)`, result.meetsTarget);

  if (result.meetsTarget) {
    stopAutoclick();
    dom.successBanner.classList.remove('hidden');
    const submit = result.submit;
    dom.successDetail.textContent = submit
      ? (submit.accepted ? `submitblock accepted! hash: ${result.hash}` : `submitblock rejected: ${submit.detail}`)
      : '(no submit attempted)';
    logLine(submit && submit.accepted ? '*** BLOCK ACCEPTED BY YOUR NODE ***' : '*** target met, but submission failed — see banner above ***', true);
  }
}

async function mineOnce() {
  if (!candidate) {
    await loadCandidate();
    if (!candidate) return;
  }

  dom.mineButton.classList.add('pressed');
  setTimeout(() => dom.mineButton.classList.remove('pressed'), 120);

  try {
    applyHashResult(await api('POST', '/api/hash', {}));
  } catch (err) {
    if (err.statusCode !== 429) {
      logLine('error: ' + err.message, false);
    }
  }
}

dom.mineButton.addEventListener('click', mineOnce);

function startAutoclick() {
  if (autoclickTimer) return;
  autoclickTimer = setInterval(mineOnce, AUTOCLICK_INTERVAL_MS);
}

function stopAutoclick() {
  if (!autoclickTimer) return;
  clearInterval(autoclickTimer);
  autoclickTimer = null;
  dom.autoclickCheckbox.checked = false;
}

dom.autoclickCheckbox.addEventListener('change', () => {
  if (dom.autoclickCheckbox.checked) {
    startAutoclick();
  } else {
    stopAutoclick();
  }
});

// ---------------------------------------------------------------------
// WebSocket — keeps status/candidate/hash in sync across every connected
// tab, live, without polling. Falls back to plain REST (already used for
// the initial page load and every user action) if the socket is down; a
// slow backstop poll below covers the case where it never connects at all.
// ---------------------------------------------------------------------

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);

  ws.addEventListener('message', (event) => {
    let message;
    try {
      message = JSON.parse(event.data);
    } catch {
      return;
    }
    switch (message.type) {
      case 'status':
        applyStatus(message.payload);
        break;
      case 'candidate':
        applyCandidate(message.payload);
        break;
      case 'hash':
        applyHashResult(message.payload);
        break;
    }
  });

  ws.addEventListener('close', () => {
    setTimeout(connectWebSocket, WS_RECONNECT_DELAY_MS);
  });
  ws.addEventListener('error', () => ws.close());
}

// ---------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------

async function init() {
  await loadSettings();
  const status = await refreshStatus();
  if (status && status.payoutConfigured) {
    await loadCandidate();
  }
  connectWebSocket();
  // Backstop only — the WebSocket normally keeps status live on its own.
  setInterval(refreshStatus, 60000);
}

init();
