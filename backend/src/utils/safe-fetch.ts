import dns from 'node:dns';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';

/**
 * Fetch a user-supplied URL without letting it reach the inside of the network.
 *
 * Checking the hostname string is not enough: `anything.example` can resolve to 127.0.0.1, and a
 * second lookup at connect time can return a different answer than the first (DNS rebinding). So
 * the check runs inside the socket's own `lookup`, on the exact address the connection will use.
 * Redirects are refused and the body is capped, so a hostile server cannot stream gigabytes.
 */

// Two lists: a single BlockList applies IPv4-mapped IPv6 rules to plain IPv4 addresses, which would
// block everything. Mapped addresses (::ffff:a.b.c.d) are unwrapped and checked as IPv4 instead.
const BLOCKED_V4 = new net.BlockList();
const BLOCKED_V6 = new net.BlockList();
// IPv4: "this" network, private, loopback, link-local (cloud metadata), CGNAT, benchmarking,
// IETF/TEST-NETs, multicast and reserved.
for (const [addr, prefix] of [
  ['0.0.0.0', 8],
  ['10.0.0.0', 8],
  ['100.64.0.0', 10],
  ['127.0.0.0', 8],
  ['169.254.0.0', 16],
  ['172.16.0.0', 12],
  ['192.0.0.0', 24],
  ['192.0.2.0', 24],
  ['192.168.0.0', 16],
  ['198.18.0.0', 15],
  ['198.51.100.0', 24],
  ['203.0.113.0', 24],
  ['224.0.0.0', 3],
] as const) {
  BLOCKED_V4.addSubnet(addr, prefix, 'ipv4');
}
// IPv6: unspecified, loopback, NAT64, unique-local, link-local, multicast.
for (const [addr, prefix] of [
  ['::', 128],
  ['::1', 128],
  ['64:ff9b::', 96],
  ['fc00::', 7],
  ['fe80::', 10],
  ['ff00::', 8],
] as const) {
  BLOCKED_V6.addSubnet(addr, prefix, 'ipv6');
}

export class UnsafeUrlError extends Error {}

/** `::ffff:127.0.0.1` / `::ffff:7f00:1` → `127.0.0.1`; anything else → null. */
function unwrapMappedIpv4(address: string): string | null {
  const lower = address.toLowerCase();
  const dotted = lower.match(/^(?:0{0,4}:){0,5}:?ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (dotted) return dotted[1]!;
  const hex = lower.match(/^(?:0{0,4}:){0,5}:?ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
  if (hex) {
    const hi = Number.parseInt(hex[1]!, 16);
    const lo = Number.parseInt(hex[2]!, 16);
    return `${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`;
  }
  return null;
}

export function isBlockedAddress(address: string): boolean {
  const family = net.isIP(address);
  if (family === 0) return true;
  if (family === 4) return BLOCKED_V4.check(address, 'ipv4');
  const mapped = unwrapMappedIpv4(address);
  if (mapped) return BLOCKED_V4.check(mapped, 'ipv4');
  return BLOCKED_V6.check(address, 'ipv6');
}

function guardedLookup(
  hostname: string,
  options: dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: string | dns.LookupAddress[], family?: number) => void,
): void {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, '', 0);
    const list = addresses as dns.LookupAddress[];
    const blocked = list.find((entry) => isBlockedAddress(entry.address));
    if (blocked || list.length === 0) {
      return callback(new UnsafeUrlError(`Access to internal address ${blocked?.address ?? hostname} is forbidden.`), '', 0);
    }
    if (options.all) return callback(null, list);
    const first = list[0]!;
    callback(null, first.address, first.family);
  });
}

export interface SafeFetchOptions {
  timeoutMs?: number;
  maxBytes?: number;
  headers?: Record<string, string>;
}

export interface SafeFetchResponse {
  body: string;
  status: number;
  /** Response headers, lower-cased names. */
  headers: Record<string, string | string[] | undefined>;
}

export async function safeFetchText(rawUrl: string, options: SafeFetchOptions = {}): Promise<string> {
  return (await safeFetchResponse(rawUrl, options)).body;
}

/** The same guarded fetch, also returning the status and headers (Last-Modified, ETag, Content-MD5 for integrity and version). */
export async function safeFetchResponse(rawUrl: string, options: SafeFetchOptions = {}): Promise<SafeFetchResponse> {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    throw new UnsafeUrlError('Invalid URL format.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new UnsafeUrlError(`Protocol "${url.protocol}" is not permitted. Only HTTP/HTTPS allowed.`);
  }
  if (url.username || url.password) {
    throw new UnsafeUrlError('URLs with embedded credentials are not permitted.');
  }
  // A literal IP skips DNS entirely, so check it here as well.
  const literal = url.hostname.replace(/^\[|\]$/g, '');
  if (net.isIP(literal) && isBlockedAddress(literal)) {
    throw new UnsafeUrlError(`Access to internal address ${literal} is forbidden.`);
  }

  const timeoutMs = options.timeoutMs ?? 8000;
  const maxBytes = options.maxBytes ?? 5 * 1024 * 1024;
  const client = url.protocol === 'https:' ? https : http;

  return new Promise<SafeFetchResponse>((resolve, reject) => {
    const req = client.get(
      url,
      { lookup: guardedLookup as unknown as net.LookupFunction, headers: options.headers, timeout: timeoutMs },
      (res) => {
        const status = res.statusCode ?? 0;
        if (status >= 300 && status < 400) {
          res.resume();
          reject(new UnsafeUrlError('HTTP redirects are blocked for security. Use the final URL directly.'));
          return;
        }
        if (status < 200 || status >= 300) {
          res.resume();
          reject(new Error(`External source returned HTTP status ${status}.`));
          return;
        }
        const chunks: Buffer[] = [];
        let received = 0;
        res.on('data', (chunk: Buffer) => {
          received += chunk.length;
          if (received > maxBytes) {
            req.destroy(new Error(`Response exceeded the ${Math.round(maxBytes / 1024 / 1024)} MB limit.`));
            return;
          }
          chunks.push(chunk);
        });
        res.on('end', () => resolve({ body: Buffer.concat(chunks).toString('utf8'), status, headers: res.headers }));
        res.on('error', reject);
      },
    );
    req.on('timeout', () => req.destroy(new Error(`Request timed out after ${timeoutMs} ms.`)));
    req.on('error', reject);
  });
}
