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
never find a block. It's a fun educational visualization of exactly what a
miner does, one hash at a time.

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

## How it works

Click Miner talks to your node's JSON-RPC interface to fetch a block
template, builds a coinbase transaction paying your configured address,
computes the merkle root and assembles an 80-byte header, then runs a single
SHA256d hash over it per click (or per auto-click tick) and compares the
result against the network target.

## Quick start (Docker)

```bash
docker build -t click-miner .
docker run -p 127.0.0.1:3000:3000 -v click-miner-data:/data click-miner
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
| `RPC_COOKIE_PATH`         | Path to node's `.cookie` file (alternative to user/pass). Env-only by design — see Security below |
| `RPC_PROTOCOL`            | `http` (default) or `https`                         |
| `PAYOUT_ADDRESS`          | Address the coinbase output pays                    |
| `PORT`                    | Port the app's own HTTP server listens on (default `3000`) |
| `DATA_DIR`                | Where `config.json` is persisted (default `./data`) |
| `STATUS_POLL_INTERVAL_MS` | How often to poll the node for chain status          |
| `HOST`                    | Address the app binds (default `127.0.0.1`)         |
| `ALLOWED_HOSTS`           | Extra comma-separated hostnames permitted in the `Host` header |
| `ALLOW_PUBLIC_RPC_HOST`   | Set `1` to allow an RPC host outside LAN/tailnet/Tor |
| `DISABLE_ORIGIN_CHECK`    | Set `1` to disable CSRF/rebinding checks (not recommended) |

See [server/settings.js](server/settings.js) for the authoritative list.

## Security

Click Miner has no login — it assumes whoever can reach its port is the
node's operator. Everything below follows from keeping that assumption
true:

- **It binds `127.0.0.1` by default.** Publish it wider only if you mean
  to (`HOST=0.0.0.0`, or a different `-p` mapping), and understand that
  anyone who can then reach the port can change your payout address.
- **Requests must be same-origin, and the `Host` header must be a private
  name** (localhost, LAN, tailnet, `.local`, `.onion`, or a Docker
  service name). Together these stop a web page you merely visit from
  driving the API, whether directly or via DNS rebinding. If your setup
  needs another hostname — a Tailscale `*.ts.net` name, say — add it to
  `ALLOWED_HOSTS`.
- **`config.json` is written `0600` inside a `0700` directory**, because
  it holds your RPC password in plaintext. Permissions are re-applied on
  every save and at startup, so a config from an older version gets
  tightened automatically.
- **Cookie auth is set with `RPC_COOKIE_PATH` only**, never through the
  web form. The server reads that file and sends its contents to the RPC
  host as credentials — a path no HTTP request should be able to choose.
- **The RPC host is confined** to loopback, LAN, tailnet, or `.onion`.
  Set `ALLOW_PUBLIC_RPC_HOST=1` if your node genuinely lives on a public
  address.

### Where your credentials live

Nothing in this repository contains credentials, and nothing ever should.
`data/config.json` is *runtime state*, not source: it is created the
moment you save settings in the UI, it is gitignored, and it is written
`0600`. There is no way to persist what you typed into a web form without
writing it somewhere — a process cannot set its own environment
variables — so a locked-down file is what that "somewhere" is.

Environment variables are supported too, and take precedence over the
file. That is how Umbrel and Start9 supply RPC details, and on those
platforms **no password is ever written to disk by this app at all**.

Env vars are not automatically safer than a `0600` file, though — they
are visible in `docker inspect`, in `/proc/<pid>/environ`, and in your
shell history. Ranked best to worst:

1. **Cookie auth** (`RPC_COOKIE_PATH`) — no password stored anywhere. Best
   when the node is on the same machine or the cookie file can be mounted.
2. **Platform injection** (Umbrel, Start9) — credentials never touch this
   app's config file.
3. **`config.json` at `0600`** — the default for desktop use. Fine, as
   long as it stays out of git.

A `.githooks/pre-commit` guard ships with the repo as a backstop against
committing any of it. Enable it once per clone:

```bash
git config core.hooksPath .githooks
```

### Hardening your node against a leaked credential

This is the one that matters most, and it is set on **bitcoind**, not
here. Click Miner only ever calls three RPC methods, so the user it
connects as does not need any others. Restrict it in `bitcoin.conf`:

```
rpcwhitelist=clickminer:getblocktemplate,submitblock,getblockchaininfo
rpcwhitelistdefault=1
```

With that in place, a leaked Click Miner credential cannot touch your
wallet, cannot move funds, and cannot stop your node — the three calls it
can make are all read-only or block submission. Create a dedicated
`rpcauth` user for this app rather than reusing your main one.

Two more worth doing:

- **Prefer `.onion` or Tailscale for a remote node.** HTTP Basic auth
  sends credentials in cleartext, so a plain-HTTP hop across a LAN is
  readable by anything on that network. A `.onion` host is encrypted and
  authenticated by the onion service itself; `RPC_PROTOCOL=https` covers
  nodes behind a TLS proxy.
- **Never expose bitcoind's RPC port to the internet.** Click Miner
  reaches it over Tor or your LAN precisely so you don't have to.

### If you think a credential leaked

1. Rotate the RPC password on the node (Umbrel: Bitcoin Node → Advanced
   Settings; or regenerate `rpcauth` in `bitcoin.conf` and restart).
2. Re-enter it in Click Miner's Settings tab.
3. If a `.onion` address was exposed, rotate the hidden service too — the
   address is how someone reaches your node at all.
4. Check the node for unexpected activity: `getconnectioncount`, recent
   wallet transactions, and whether any unknown wallet was loaded.

## Privacy

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
