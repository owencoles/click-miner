// Click Miner frontend: settings form, live header-field rendering, the
// click/auto-click loop against the /api/* routes, and a WebSocket client
// that keeps every connected tab in sync (status, candidate, and hash
// events) without polling.
//
// All user-facing text comes from ./copy.js (see that file to edit any
// label, message, or paragraph in the app).

import { COPY } from './copy.js';

const AUTOCLICK_INTERVAL_MS = 1000; // once per second — capped, never competitive
const WS_RECONNECT_DELAY_MS = 3000;
const LIGHTNING_ADDRESS = 'rubyred810@walletofsatoshi.com';

const el = (id) => document.getElementById(id);

const dom = {
  statusLed: el('status-led'),
  statusText: el('status-text'),
  hashesSubmitted: el('hashes-submitted'),

  settingsForm: el('settings-form'),
  settingsMessage: el('settings-message'),
  inputHost: el('input-host'),
  inputPort: el('input-port'),
  inputUsername: el('input-username'),
  inputPassword: el('input-password'),
  cookieNote: el('cookie-note'),
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

  hashrateShareCaption: el('hashrate-share-caption'),

  footerLightningLink: el('footer-lightning-link'),
  lightningModal: el('lightning-modal'),
  lightningModalClose: el('lightning-modal-close'),
  lightningQr: el('lightning-qr'),
  lightningAddressText: el('lightning-address-text'),
  lightningCopyButton: el('lightning-copy-button'),
};

let candidate = null;
let targetLeadingZeroBits = 0;
let autoclickTimer = null;
// Lifetime hash count, kept in sync with the server's persistent total
// (see server/stats.js) — also doubles as the WS/HTTP dedupe key below.
let lastAppliedAttempts = 0;
let initialSetupPromptShown = false;
// Estimated network hashes/sec, derived from the node's reported
// difficulty (difficulty * 2^32 / 600s — the same approximation the
// Learn tab explains). Used only for the "your share" fun-stat.
let networkHashrate = null;

// ---------------------------------------------------------------------
// copy — fills in every static label/button/heading/message from
// copy.js, and builds the Learn tab's sections from COPY.learn.sections.
// ---------------------------------------------------------------------

function applyCopy() {
  document.title = COPY.meta.pageTitle;
  el('marquee-text').textContent = COPY.marquee;
  el('banner-title').textContent = COPY.banner.title;
  el('banner-tagline').textContent = COPY.banner.tagline;
  dom.statusText.textContent = COPY.status.checking;

  el('tab-btn-mine').textContent = COPY.tabs.mine;
  el('tab-btn-settings').textContent = COPY.tabs.settings;
  el('tab-btn-learn').textContent = COPY.tabs.learn;

  dom.hashesSubmitted.textContent = COPY.mine.hashesSubmitted(0);
  dom.mineButton.textContent = COPY.mine.mineButton;
  el('autoclick-label').textContent = COPY.mine.autoclickLabel;
  el('target-bar-label').textContent = COPY.mine.targetBarLabel;
  dom.targetBarCaption.textContent = COPY.mine.targetBarCaption(0, 0);
  el('last-hash-label').textContent = COPY.mine.lastHashLabel;
  dom.lastHash.textContent = COPY.mine.lastHashPlaceholder;
  el('success-title').textContent = COPY.mine.successTitle;
  el('header-window-title-prefix').textContent = COPY.mine.headerWindowTitlePrefix;

  const fieldIds = { version: 'version', prevhash: 'prevHash', merkleroot: 'merkleRoot', time: 'time', bits: 'bits', nonce: 'nonce', coinbase: 'coinbase' };
  for (const [domSuffix, copyKey] of Object.entries(fieldIds)) {
    el(`label-${domSuffix}`).textContent = COPY.mine.fields[copyKey].label;
    el(`help-${domSuffix}`).textContent = COPY.mine.fields[copyKey].help;
  }

  el('header-hex-label').textContent = COPY.mine.headerHexLabel;
  dom.fieldHeaderHex.textContent = COPY.mine.headerHexPlaceholder;
  dom.refreshButton.textContent = COPY.mine.refreshButton;
  el('log-window-title').textContent = COPY.mine.logWindowTitle;
  el('hashrate-window-title').textContent = COPY.mine.hashrateWindowTitle;
  dom.hashrateShareCaption.textContent = COPY.mine.hashrateSharePlaceholder;

  el('settings-window-title').textContent = COPY.settings.windowTitle;
  el('settings-intro').innerHTML = COPY.settings.intro;
  el('rpc-legend').textContent = COPY.settings.rpcLegend;
  el('host-label').textContent = COPY.settings.hostLabel;
  dom.inputHost.placeholder = COPY.settings.hostPlaceholder;
  el('port-label').textContent = COPY.settings.portLabel;
  dom.inputPort.placeholder = COPY.settings.portPlaceholder;
  el('username-label').textContent = COPY.settings.usernameLabel;
  el('password-label').textContent = COPY.settings.passwordLabel;
  dom.inputPassword.placeholder = COPY.settings.passwordPlaceholder;
  el('payout-legend').textContent = COPY.settings.payoutLegend;
  el('payout-label').textContent = COPY.settings.payoutLabel;
  dom.inputPayoutAddress.placeholder = COPY.settings.payoutPlaceholder;
  el('payout-help').textContent = COPY.settings.payoutHelp;
  el('save-settings-button').textContent = COPY.settings.saveButton;

  el('learn-window-title').textContent = COPY.learn.windowTitle;
  const learnBody = el('learn-body');
  learnBody.innerHTML = '';
  for (const section of COPY.learn.sections) {
    const heading = document.createElement('h3');
    heading.textContent = section.heading;
    learnBody.appendChild(heading);
    const body = document.createElement('div');
    body.innerHTML = section.html;
    while (body.firstChild) {
      learnBody.appendChild(body.firstChild);
    }
  }

  el('footer-github-link').textContent = COPY.footer.githubLinkText;
  dom.footerLightningLink.textContent = COPY.footer.lightningLinkText;

  el('lightning-modal-title').textContent = COPY.lightning.modalTitle;
  el('lightning-modal-caption').textContent = COPY.lightning.caption;
  dom.lightningAddressText.textContent = LIGHTNING_ADDRESS;
  dom.lightningCopyButton.textContent = COPY.lightning.copyButton;
}

// ---------------------------------------------------------------------
// tabs
// ---------------------------------------------------------------------

const tabButtons = Array.from(document.querySelectorAll('.tab-btn'));
const tabPanels = Array.from(document.querySelectorAll('.tab-panel'));

function showTab(name) {
  for (const btn of tabButtons) {
    btn.classList.toggle('active', btn.dataset.tab === name);
  }
  for (const panel of tabPanels) {
    panel.classList.toggle('hidden', panel.dataset.tabPanel !== name);
  }
  try {
    localStorage.setItem('click-miner-tab', name);
  } catch {
    // localStorage unavailable (private browsing, etc.) — not persisting the tab is fine.
  }
}

for (const btn of tabButtons) {
  btn.addEventListener('click', () => showTab(btn.dataset.tab));
}

// ---------------------------------------------------------------------
// lightning tip modal
// ---------------------------------------------------------------------

// Rendered once and cached — the address is fixed, so there's no reason
// to regenerate the QR SVG on every open.
let lightningQrRendered = false;

function renderLightningQr() {
  if (lightningQrRendered) return;
  lightningQrRendered = true;
  const qr = qrcode(0, 'M');
  qr.addData(LIGHTNING_ADDRESS);
  qr.make();
  dom.lightningQr.innerHTML = qr.createSvgTag({ cellSize: 4, margin: 8 });
}

function openLightningModal() {
  renderLightningQr();
  dom.lightningModal.classList.remove('hidden');
}

function closeLightningModal() {
  dom.lightningModal.classList.add('hidden');
}

dom.footerLightningLink.addEventListener('click', (event) => {
  event.preventDefault();
  openLightningModal();
});

dom.lightningModalClose.addEventListener('click', closeLightningModal);

dom.lightningModal.addEventListener('click', (event) => {
  if (event.target === dom.lightningModal) closeLightningModal();
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !dom.lightningModal.classList.contains('hidden')) {
    closeLightningModal();
  }
});

dom.lightningCopyButton.addEventListener('click', async () => {
  try {
    await navigator.clipboard.writeText(LIGHTNING_ADDRESS);
    dom.lightningCopyButton.textContent = COPY.lightning.copyDone;
    setTimeout(() => {
      dom.lightningCopyButton.textContent = COPY.lightning.copyButton;
    }, 1500);
  } catch {
    // Clipboard API unavailable/denied — the address is still selectable text.
  }
});

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

// Writes out a tiny percentage in full decimal form instead of scientific
// notation — e.g. "0.0000000000000000001%" rather than "1e-19%" — since
// seeing every single zero spelled out is the actual joke.
function formatFullPercent(percent) {
  if (!isFinite(percent) || percent <= 0) return '0%';
  if (percent >= 1) return percent.toFixed(2) + '%';
  const exponent = Math.floor(Math.log10(percent));
  const decimalPlaces = Math.min(100, -exponent + 4);
  const trimmed = percent.toFixed(decimalPlaces).replace(/0+$/, '').replace(/\.$/, '');
  return trimmed + '%';
}

// Network hashrate ≈ difficulty × 2^32 / 600s (see the Learn tab's "actual
// math" section for the derivation). Our "share" is just our lifetime
// hash count divided by one second's worth of that — a deliberately silly
// comparison (a count against a rate) that produces the joke: an
// absurdly, comically tiny percentage.
function updateHashrateShare() {
  if (!networkHashrate || networkHashrate <= 0) {
    dom.hashrateShareCaption.textContent = COPY.mine.hashrateSharePlaceholder;
    return;
  }
  const percent = (lastAppliedAttempts / networkHashrate) * 100;
  dom.hashrateShareCaption.textContent = COPY.mine.hashrateShareCaption(formatFullPercent(percent));
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
  dom.inputPassword.placeholder = settings.hasPassword ? COPY.settings.passwordUnchangedPlaceholder : COPY.settings.passwordPlaceholder;
  dom.inputPayoutAddress.value = settings.payoutAddress || '';

  // Cookie auth is env-managed (RPC_COOKIE_PATH), so it shows as a note
  // rather than a field. When it's on, bitcoind ignores user/password.
  const usingCookie = Boolean(settings.cookiePath);
  dom.cookieNote.hidden = !usingCookie;
  if (usingCookie) {
    dom.cookieNote.textContent = COPY.settings.cookieNote(settings.cookiePath);
  }
  dom.inputUsername.disabled = usingCookie;
  dom.inputPassword.disabled = usingCookie;
  return settings;
}

dom.settingsForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  setMessage(dom.settingsMessage, COPY.settings.saving);

  const body = {
    host: dom.inputHost.value.trim(),
    port: dom.inputPort.value ? Number(dom.inputPort.value) : undefined,
    username: dom.inputUsername.value,
    payoutAddress: dom.inputPayoutAddress.value.trim(),
  };
  if (dom.inputPassword.value) {
    body.password = dom.inputPassword.value;
  }

  try {
    await api('POST', '/api/settings', body);
    setMessage(dom.settingsMessage, COPY.settings.saved, 'ok');
    dom.inputPassword.value = '';
    await refreshStatus();
    await loadCandidate();
  } catch (err) {
    setMessage(dom.settingsMessage, COPY.settings.saveError(err.message), 'error');
  }
});

// ---------------------------------------------------------------------
// status
// ---------------------------------------------------------------------

function applyStatus(status) {
  if (status.node) {
    dom.statusLed.className = 'led ok';
    dom.statusText.textContent = COPY.status.connected(status.node.chain);
    if (status.node.difficulty) {
      networkHashrate = (status.node.difficulty * 2 ** 32) / 600;
      updateHashrateShare();
    }
  } else {
    dom.statusLed.className = 'led error';
    dom.statusText.textContent = COPY.status.nodeUnreachable(status.nodeError);
  }
  // Nudge a first-time visitor to Settings once, without repeatedly
  // yanking them back there on every later status broadcast if they've
  // deliberately navigated elsewhere while still mid-setup.
  if (!status.payoutConfigured && !initialSetupPromptShown) {
    initialSetupPromptShown = true;
    showTab('settings');
  }
}

async function refreshStatus() {
  dom.statusLed.className = 'led pending';
  dom.statusText.textContent = COPY.status.checking;
  try {
    const status = await api('GET', '/api/status');
    applyStatus(status);
    return status;
  } catch (err) {
    dom.statusLed.className = 'led error';
    dom.statusText.textContent = COPY.status.checkFailed(err.message);
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
  dom.fieldNonce.value = candidate.nonce;
  dom.fieldCoinbaseValue.textContent = `${(candidate.coinbase.valueSats / 1e8).toFixed(8)} BTC → ${candidate.payoutAddress} (${candidate.payoutType})`;
  dom.fieldHeaderHex.textContent = candidate.headerHex;
  dom.hashesSubmitted.textContent = COPY.mine.hashesSubmitted(candidate.attempts);
  updateHashrateShare();

  targetLeadingZeroBits = hexLeadingZeroBits(candidate.target);
}

// `attempts` is the server's persistent lifetime hash count (see
// server/stats.js) — it doesn't reset when the candidate/template
// refreshes, so syncing lastAppliedAttempts here just keeps the dedupe
// guard (see applyHashResult) caught up with whatever the server already
// knows, rather than resetting it.
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
  setMessage(dom.candidateMessage, COPY.mine.refreshFetching);
  try {
    applyCandidate(await api('POST', '/api/candidate/refresh'));
    setMessage(dom.candidateMessage, COPY.mine.refreshDone, 'ok');
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
  dom.fieldNonce.value = result.nonce;
  dom.fieldHeaderHex.textContent = result.headerHex;
  dom.hashesSubmitted.textContent = COPY.mine.hashesSubmitted(result.attempts);
  updateHashrateShare();

  dom.lastHash.textContent = result.hash;

  const pct = targetLeadingZeroBits > 0
    ? Math.min(100, (result.leadingZeroBits / targetLeadingZeroBits) * 100)
    : 0;
  dom.targetBarFill.style.width = pct + '%';
  dom.targetBarCaption.textContent = COPY.mine.targetBarCaption(result.leadingZeroBits, targetLeadingZeroBits);

  logLine(COPY.mine.logLine(result.attempts, result.nonce, result.hash.slice(0, 24), result.leadingZeroBits), result.meetsTarget);

  if (result.meetsTarget) {
    stopAutoclick();
    dom.successBanner.classList.remove('hidden');
    const submit = result.submit;
    dom.successDetail.textContent = submit
      ? (submit.accepted ? COPY.mine.successAccepted(result.hash) : COPY.mine.successRejected(submit.detail))
      : COPY.mine.successNoSubmit;
    logLine(submit && submit.accepted ? COPY.mine.logHitAccepted : COPY.mine.logHitRejected, true);
  }
}

async function mineOnce() {
  if (!candidate) {
    await loadCandidate();
    if (!candidate) return;
  }

  dom.mineButton.classList.add('pressed');
  setTimeout(() => dom.mineButton.classList.remove('pressed'), 120);

  // If the user has typed a different value into the nonce field, use it
  // for this click instead of letting the server auto-increment. Once
  // applied, the field reflects the server's actual nonce again, so the
  // next click — without further edits — falls straight back to auto-
  // increment with no extra state to track.
  const body = {};
  const manualNonce = Number(dom.fieldNonce.value);
  if (
    Number.isInteger(manualNonce) &&
    manualNonce >= 0 &&
    manualNonce <= 0xffffffff &&
    manualNonce !== candidate.nonce
  ) {
    body.nonce = manualNonce;
  }

  try {
    applyHashResult(await api('POST', '/api/hash', body));
  } catch (err) {
    if (err.statusCode !== 429) {
      logLine(COPY.mine.logError(err.message), false);
    }
  }
}

dom.mineButton.addEventListener('click', mineOnce);

function startAutoclick() {
  if (autoclickTimer) return;
  autoclickTimer = setInterval(mineOnce, AUTOCLICK_INTERVAL_MS);
  dom.autoclickCheckbox.checked = true;
  dom.fieldNonce.disabled = true;
}

function stopAutoclick() {
  if (!autoclickTimer) return;
  clearInterval(autoclickTimer);
  autoclickTimer = null;
  dom.autoclickCheckbox.checked = false;
  dom.fieldNonce.disabled = false;
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

let currentWs = null;

function connectWebSocket() {
  const protocol = location.protocol === 'https:' ? 'wss:' : 'ws:';
  const ws = new WebSocket(`${protocol}//${location.host}/ws`);
  currentWs = ws;

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

// A backgrounded tab or a laptop going to sleep can leave the WebSocket
// dead without ever firing 'close' (so the reconnect logic above never
// triggers), and browsers throttle setInterval in background tabs — so
// status can go stale and silently stay that way. The moment the tab is
// actually looked at again, force a fresh REST sync and make sure the
// socket is really still open, reconnecting if not.
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  refreshStatus();
  if (candidate) loadCandidate();
  if (!currentWs || currentWs.readyState !== WebSocket.OPEN) {
    connectWebSocket();
  }
});

// ---------------------------------------------------------------------
// boot
// ---------------------------------------------------------------------

async function init() {
  applyCopy();

  let initialTab = 'mine';
  try {
    initialTab = localStorage.getItem('click-miner-tab') || 'mine';
  } catch {
    // localStorage unavailable — default to the mine tab.
  }
  showTab(initialTab);

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
