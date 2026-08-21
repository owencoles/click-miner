FROM node:20-alpine

# Tor client — lets the RPC layer reach a node's .onion address over a
# local SOCKS5 proxy (127.0.0.1:9050), which is Umbrel's supported path
# for external RPC access without exposing the raw port on the LAN.
RUN apk add --no-cache tor

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public
COPY docker/torrc /etc/tor/torrc
COPY docker/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

ENV NODE_ENV=production
ENV PORT=3000
ENV DATA_DIR=/data
# Binds all interfaces *within the container* — Docker forwards to the
# container's IP, so a loopback bind here would make `-p` unreachable.
# The exposure boundary is the port mapping you run with: use
# `-p 127.0.0.1:3000:3000` to keep it on your own machine.
ENV HOST=0.0.0.0

RUN mkdir -p /data /var/lib/tor \
  && chown -R node:node /data /var/lib/tor \
  && chmod +x /usr/local/bin/docker-entrypoint.sh
USER node

EXPOSE 3000
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/ >/dev/null 2>&1 || exit 1

ENTRYPOINT ["docker-entrypoint.sh"]
