# Click Miner — Project Spec

## 1. What this is

Click Miner is a free, open-source, educational "manual Bitcoin miner." The user
clicks a button, the app assembles one real Bitcoin block header (using live data
from a connected Bitcoin node), computes a single SHA256d hash against a chosen
nonce, and checks it against the current network target. On the ~1-in-10^23 chance
it's below target, it submits the block to the network via the connected node.

It is **not** a real mining tool in any competitive sense — it will essentially
never find a block. It's a toy / educational visualization of exactly what a miner
does, one hash at a time, built with a wink at how hopeless solo manual mining is.

**Tagline energy:** tongue-in-cheek, Bitcoin-ethos, "be your own miner (lol)."

## 2. Goals

- Show, in real time and in full, every value involved in mining a block:
  previous block hash, merkle root, version, timestamp, bits/target, nonce,
  and the resulting double-SHA256 hash — with a live comparison against target.
- Let the user manually pick/increment the nonce and/or timestamp and trigger
  one hash calculation per click (or a slow "auto-click" loop for fun, capped
  low enough to stay clearly non-competitive with real mining hardware).
- Connect to the **user's own Bitcoin full node** via RPC — this is the
  preferred/essential mode. No bundled node, no third-party pool by default.
- Be as small, simple, and dependency-light as reasonably possible.
- Run identically across: **Umbrel, Start9, macOS, Windows, Linux.**
- 100% free and open source (MIT license).

## 3. Non-goals

- Not trying to be performant or competitive hashrate-wise.
- Not handling private key management or financial advice. The user supplies
  a **payout address only** (never a private key) — this app never holds,
  generates, or has access to keys or funds.
- Not a pool client — no pool protocol (Stratum) needed for v1, just solo via
  the user's own node (`getblocktemplate` / `submitblock`).

## 4. Tech stack

- **Backend:** Node.js (minimal — built-in `http`/`crypto` modules or a tiny
  router like `polka`; avoid heavy frameworks).
- **Frontend:** Plain HTML/CSS/JS. No React/build step — keep it simple and
  auditable, and easy to skin.
- **Node communication:** JSON-RPC over HTTP to the user's `bitcoind`
  (`getblocktemplate`, `submitblock`, `getblockchaininfo` for status/target).
- **Packaging:** Docker container as the universal distribution format —
  works for Umbrel, Start9, and via plain `docker run` on desktop OSes.

## 5. Design direction: retro 90s / early-2000s web

Lean all the way in — this is part of the joke and the charm:

- Chunky beveled/3D borders on buttons and panels (classic Windows 95/98
  button style), NOT modern flat/soft-shadow design.
- Tiled background pattern (subtle, not obnoxious) or a starfield/space gif vibe.
- Retro color palette: teal/purple/orange gradients, or classic grey Windows
  chrome with bright accent colors.
- Table-based layout feel (can still use CSS Grid/Flexbox under the hood, just
  make it *look* like `<table>` era HTML).
- Fonts: Times New Roman / Comic Sans / system-default bitmap-y fonts for
  headers; monospace for hash/hex values (this part should look terminal-y
  and legible, it's the "data" of the page).
- Fun period-accurate flourishes: blinking "LIVE" indicator, a visitor/attempt
  hit-counter widget, marquee-style scrolling status text, an "under
  construction" gif easter egg, a big chunky "MINE!" button with a pressed
  state.
- Keep it legible and actually usable — retro skin, not retro usability.

## 6. Core app structure

```
click-miner/
├── server/
│   ├── index.js        # HTTP + WebSocket server, serves /public, API routes
│   ├── rpc.js           # JSON-RPC client for user's bitcoind
│   ├── header.js         # Builds candidate block header from template + merkle root
│   ├── hash.js            # SHA256d, target/difficulty comparison
│   ├── address.js          # Decodes a payout address into a scriptPubKey
│   ├── coinbase.js           # Builds the coinbase tx paying the block reward to the payout address
│   └── settings.js             # Reads/writes RPC connection config + payout address
├── public/
│   ├── index.html            # Main UI
│   ├── style.css               # Retro theme
│   └── app.js                    # Click handler, live field rendering, WebSocket client
├── docker-compose.yml               # Umbrel packaging
├── umbrel-app.yml                     # Umbrel manifest (name, icon, port, deps on bitcoin node)
├── start9/
│   └── manifest.yaml                    # Start9 packaging equivalent
├── Dockerfile
├── LICENSE                                # MIT
└── README.md
```

## 7. Core functionality (v1 scope)

1. **Settings screen:** RPC host, port, username, password (or cookie auth
   path), and a **payout address** (any standard address type — legacy
   P2PKH, P2SH, native SegWit P2WPKH/P2WSH, or Taproot P2TR). On
   Umbrel/Start9, RPC fields pre-fill from platform-injected env vars when
   the app declares a dependency on the user's own bitcoin node app; the
   payout address is always entered by the user. On desktop, user enters
   their own node's local/remote RPC details manually.
2. **Fetch template:** call `getblocktemplate` to get previous block hash,
   transactions, coinbase value, current target/bits, height.
3. **Build coinbase transaction:** construct the coinbase tx paying
   `coinbasevalue` (subsidy + fees) to the configured payout address's
   scriptPubKey, including the BIP34 height push and the witness commitment
   output when the template includes segwit transactions.
4. **Build header:** compute merkle root from the coinbase txid + included
   transactions, assemble the 80-byte block header (version, prevhash,
   merkleroot, time, bits, nonce).
5. **Display everything live:** all header fields in hex, in a clearly labeled
   panel, updating whenever the template refreshes.
6. **Click to hash:** on button click, run one SHA256d over the header with
   the current nonce (auto-incrementing or user-editable), show the resulting
   hash, and visually compare it against the target (e.g. leading-zeros bar).
7. **On (nearly impossible) success:** assemble the full block (header +
   coinbase tx incl. witness data + remaining transactions) and call
   `submitblock` on the user's node — the block reward pays out to the
   configured address automatically, same as any other miner.
8. **Educational copy:** short inline explanations of what each field means
   and why the odds are what they are — this is a big part of the point.

## 8. Platform packaging notes

- **Umbrel:** Docker Compose app + `umbrel-app.yml` manifest; declare a
  dependency on the Umbrel Bitcoin Node app so RPC host/port/user/pass are
  auto-injected as env vars.
- **Start9:** equivalent `s9pk` packaging with a manifest declaring a
  dependency/interface on the Start9 Bitcoin service.
- **Desktop (macOS/Windows/Linux):** same Docker image, run via
  `docker run` (documented in README); user points it at their own node's
  RPC (local, Tailscale, etc). No Electron/Tauri wrapper planned for v1 —
  keep footprint minimal.

## 9. License & distribution

- MIT license, public GitHub repo.
- No telemetry, no analytics, no external calls except to the user's own
  configured node.
