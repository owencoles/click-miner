# Click Miner

A free, open-source, educational "manual Bitcoin miner." Click a button, the
app assembles one real Bitcoin block header using live data from your own
connected node, computes a single SHA256d hash against a chosen nonce, and
checks it against the current network target.

It's not a real mining tool in any competitive sense — it will essentially
never find a block. It's a toy / educational visualization of exactly what a
miner does, one hash at a time. Be your own miner (lol).

See [CLICK-MINER-SPEC.md](CLICK-MINER-SPEC.md) for the full project spec.

## Running on desktop (macOS / Windows / Linux), via Docker

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

```bash
npm install
npm start
```

Settings (RPC connection + payout address) persist to `./data/config.json`
by default; override the location with the `DATA_DIR` env var. See
`server/settings.js` for the full list of env vars (`RPC_HOST`, `RPC_PORT`,
`RPC_USER`, `RPC_PASSWORD`, `RPC_COOKIE_PATH`, `PAYOUT_ADDRESS`, `PORT`,
`DATA_DIR`, `STATUS_POLL_INTERVAL_MS`).

## License

MIT — see [LICENSE](LICENSE).
