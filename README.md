<div align="center">

<img src="public/icons/icon-512.png" width="96" height="96" alt="Click Miner logo" />

# Click Miner

**The world's least efficient bitcoin miner.**

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg)](package.json)
[![Docker](https://img.shields.io/badge/docker-ready-2496ED.svg?logo=docker&logoColor=white)](Dockerfile)

</div>

A free, open-source, educational "manual Bitcoin miner." Click a button, the
app assembles one real Bitcoin block header using live data from your own
connected node, computes a single SHA256d hash against a chosen nonce, and
checks it against the current network target.

It's not a real mining tool in any competitive sense — it will essentially
never find a block. It's a toy / educational visualization of exactly what a
miner does, one hash at a time. Be your own miner (lol).

## Features

- **Real block data, one real hash per click.** Every field (version, prev
  block hash, merkle root, time, bits, nonce) comes from your own node's
  `getblocktemplate`, and a real block gets submitted via `submitblock` on
  the (astronomically unlikely) chance a hash beats the target.
- **Your node, your payout address, your keys.** Click Miner never holds,
  generates, or touches a private key — you supply a payout address only.
- **Zero telemetry.** No analytics, no third-party calls — the only network
  request this app makes is to the Bitcoin node you point it at.
- **Runs anywhere:** plain Docker on macOS/Windows/Linux, Umbrel, or (soon)
  Start9 — same image everywhere.
- Optional slow "auto-click" loop, live leading-zero-bits-vs-target
  indicator, and short inline explanations of what each field means.

## Quick start (Docker)

```bash
docker build -t click-miner .
docker run -p 3000:3000 -v click-miner-data:/data click-miner
```

Then open http://localhost:3000. You'll need your own Bitcoin full node
reachable via RPC (local, Tailscale, etc.) — host/port/credentials and your
payout address are entered in-app under Settings. The `-v` volume persists
that configuration across container restarts; drop it if you don't need
that.

To point at a node on your LAN or a remote node instead of localhost, no
extra flags are needed — just enter that host in the in-app settings after
the container is running.

New to this? Try it against a `signet` or `testnet` node first before
pointing it at mainnet — the mechanics are identical and there's nothing to
lose while you get familiar with it.

## Running on Umbrel

`docker-compose.yml` + `umbrel-app.yml` at the repo root are Umbrel's
packaging files. They declare a dependency on Umbrel's own Bitcoin Node app,
which auto-injects RPC connection details — no manual RPC setup needed, only
your payout address. Install via Umbrel's app store tooling (community app
store for now, since this hasn't been submitted to the official store).

**Note:** `docker-compose.yml`'s `app_proxy` service intentionally has no
image — Umbrel's installer supplies it. Running this file directly with
`docker compose up` will fail; it's only meant to be processed by Umbrel's
app framework.

## Running on Start9

`start9/manifest.yaml` is a work-in-progress StartOS package manifest. Its
top-level fields are verified against a real shipped StartOS package, but
the dependency/RPC-credential wiring to StartOS's bitcoind package is **not
yet verified** — StartOS's mechanism for this is more involved than
Umbrel's static env-var injection, and needs confirming against the current
start-sdk docs and a working example before this can actually be packaged.
See the comment at the top of that file for specifics. Contributions
welcome.

## Development

Requires Node.js 18+.

```bash
npm install
npm start
```

Settings (RPC connection + payout address) persist to `./data/config.json`
by default; override the location with the `DATA_DIR` env var.

| Env var                  | Purpose                                             |
| ------------------------ | ---------------------------------------------------- |
| `RPC_HOST`                | Bitcoin node RPC host                               |
| `RPC_PORT`                | Bitcoin node RPC port                               |
| `RPC_USER`                | RPC username                                        |
| `RPC_PASSWORD`            | RPC password                                        |
| `RPC_COOKIE_PATH`         | Path to node's `.cookie` file (alternative to user/pass) |
| `PAYOUT_ADDRESS`          | Address the coinbase output pays                    |
| `PORT`                    | Port the app's own HTTP server listens on (default `3000`) |
| `DATA_DIR`                | Where `config.json` is persisted (default `./data`) |
| `STATUS_POLL_INTERVAL_MS` | How often to poll the node for chain status          |

See [server/settings.js](server/settings.js) for the authoritative list.

## How it works

Click Miner talks to your node's JSON-RPC interface to fetch a block
template, builds a coinbase transaction paying your configured address,
computes the merkle root and assembles an 80-byte header, then runs a single
SHA256d hash over it per click (or per auto-click tick) and compares the
result against the network target. Full design notes, goals, and non-goals
are in [CLICK-MINER-SPEC.md](CLICK-MINER-SPEC.md).

## Security & privacy

- This app **never** handles private keys — only a public payout address.
- No analytics, tracking, or calls to any third party — only to the node
  you configure.
- RPC credentials and your payout address are stored locally in
  `config.json` (or supplied via env vars); they never leave your machine
  except in the RPC calls you've configured.
- Point this at a node you control. Treat it like any other application
  with your node's RPC credentials.

## Contributing

Issues and PRs are welcome — see the [open issues](../../issues) for ideas,
especially around Start9 packaging (see above) and additional address
types. This is deliberately a small, dependency-light, plain HTML/CSS/JS +
Node.js codebase with no build step; please keep contributions in that
spirit.

## Support

Click Miner is free and has no ads, telemetry, or paid tier. If you'd like
to say thanks, there's an in-app Lightning tip jar in the footer.

## License

MIT — see [LICENSE](LICENSE).
