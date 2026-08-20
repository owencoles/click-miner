#!/bin/sh
# Starts the bundled Tor client in the background (so the app can reach
# .onion RPC addresses over SOCKS5 on 127.0.0.1:9050), then runs the app
# as the container's foreground process.
set -e

tor -f /etc/tor/torrc &

exec node server/index.js
