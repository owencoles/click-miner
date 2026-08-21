// Host classification, shared by two guards that both need the same
// question answered — "is this name/address part of the operator's own
// world, or is it somewhere out on the public internet?"
//
//   - server/rpc.js uses it outbound, so a writable `host` setting can't
//     be pointed at an arbitrary internet target (SSRF).
//   - server/index.js uses it inbound, on the Host header, so a public
//     domain rebound to 127.0.0.1 can't drive the API from a page the
//     user merely visited (DNS rebinding).
//
// The deployments Click Miner actually ships into all land on the private
// side: Umbrel injects a 10.x container IP, Start9 a private address,
// desktop users use localhost, and remote nodes are reached over Tor
// (.onion) or Tailscale (100.64.0.0/10). A rebinding attacker, by
// contrast, must use a public FQDN they control — which is exactly what
// this rejects.

import net from 'node:net';

// Single-label names (no dot) are Docker/Umbrel service names and LAN
// hostnames — they can't be registered publicly, so they can't be rebound.
const PRIVATE_SUFFIXES = ['.onion', '.local', '.internal', '.localhost'];

function parseIpv4(host) {
  const parts = host.split('.');
  if (parts.length !== 4) return null;
  const octets = parts.map((p) => Number(p));
  if (octets.some((n) => !Number.isInteger(n) || n < 0 || n > 255)) return null;
  return octets;
}

function isPrivateIpv4(host) {
  const o = parseIpv4(host);
  if (!o) return false;
  if (o[0] === 127) return true; // loopback
  if (o[0] === 10) return true; // RFC1918
  if (o[0] === 172 && o[1] >= 16 && o[1] <= 31) return true; // RFC1918
  if (o[0] === 192 && o[1] === 168) return true; // RFC1918
  if (o[0] === 169 && o[1] === 254) return true; // link-local
  if (o[0] === 100 && o[1] >= 64 && o[1] <= 127) return true; // CGNAT / Tailscale
  return false;
}

function isPrivateIpv6(host) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, '');
  if (h === '::1' || h === '::') return true; // loopback / unspecified
  if (h.startsWith('fc') || h.startsWith('fd')) return true; // unique-local
  if (h.startsWith('fe80')) return true; // link-local
  // IPv4-mapped (::ffff:127.0.0.1) — classify by the embedded address.
  const mapped = h.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
  if (mapped) return isPrivateIpv4(mapped[1]);
  return false;
}

// True for anything that belongs to the operator's own machine, LAN,
// tailnet, or Tor — i.e. not a public internet destination.
export function isPrivateHost(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim().toLowerCase().replace(/\.$/, '');
  if (!h) return false;

  const bare = h.replace(/^\[|\]$/g, '');
  if (net.isIPv4(bare)) return isPrivateIpv4(bare);
  if (net.isIPv6(bare)) return isPrivateIpv6(bare);

  if (h === 'localhost') return true;
  if (PRIVATE_SUFFIXES.some((suffix) => h.endsWith(suffix))) return true;
  // No dot => unqualified name; not publicly registrable.
  if (!h.includes('.')) return true;

  return false;
}

// Hostname syntax check (RFC 1123 labels). Rejects the whitespace, CRLF,
// and control characters that would otherwise be persisted into config
// and only fail later, deep inside the HTTP client.
const LABEL = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i;

export function isValidHostname(host) {
  if (typeof host !== 'string') return false;
  const h = host.trim();
  if (!h || h.length > 255) return false;

  const bare = h.replace(/^\[|\]$/g, '');
  if (net.isIP(bare)) return true;

  return h.replace(/\.$/, '').split('.').every((label) => LABEL.test(label));
}

// Splits a Host header into its hostname, tolerating IPv6 literals in
// brackets and an optional :port suffix. Returns '' if it can't parse.
export function hostnameFromHeader(hostHeader) {
  if (typeof hostHeader !== 'string' || !hostHeader) return '';
  const value = hostHeader.trim();
  if (value.startsWith('[')) {
    const end = value.indexOf(']');
    return end === -1 ? '' : value.slice(0, end + 1);
  }
  return value.split(':')[0];
}
