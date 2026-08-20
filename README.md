# Click Miner

A free, open-source, educational "manual Bitcoin miner." Click a button, the
app assembles one real Bitcoin block header using live data from your own
connected node, computes a single SHA256d hash against a chosen nonce, and
checks it against the current network target.

It's not a real mining tool in any competitive sense — it will essentially
never find a block. It's a toy / educational visualization of exactly what a
miner does, one hash at a time. Be your own miner (lol).

Status: early scaffold — see [CLICK-MINER-SPEC.md](CLICK-MINER-SPEC.md) for
the full project spec.

## Running (desktop, via Docker)

```bash
docker build -t click-miner .
docker run -p 3000:3000 click-miner
```

Then open http://localhost:3000. You'll need your own Bitcoin full node
reachable via RPC — settings for that are configured in-app.

## Development

```bash
npm install
npm start
```

## License

MIT — see [LICENSE](LICENSE).
