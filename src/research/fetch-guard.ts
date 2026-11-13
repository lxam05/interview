import dns from "node:dns";
import type { LookupFunction } from "node:net";
import ipaddr from "ipaddr.js";
import { Agent, fetch as undiciFetch } from "undici";
import { errors } from "./errors";

/*
 * The research engine fetches URLs that came from search results and admin
 * input. Without a guard, a URL could point the server at its own network.
 *
 *   url ──> scheme http/https? ──no──> BlockedAddress
 *             │ yes
 *             v
 *        DNS lookup (at connect time, so a rebinding host cannot slip past)
 *             │
 *        every address public unicast? ──no──> BlockedAddress
 *             │ yes
 *        fetch with redirect:"manual", each hop re-enters at the top (max 5)
 *             │
 *        body read up to MAX_BYTES, within TIMEOUT_MS
 */

const MAX_BYTES = 2_000_000;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 5;
export const USER_AGENT = "interview-prep-research/0.1 (student interview prep; respects robots.txt)";

export function isPublicAddress(address: string): boolean {
  if (!ipaddr.isValid(address)) return false;
  let ip = ipaddr.parse(address);
  if (ip.kind() === "ipv6" && (ip as ipaddr.IPv6).isIPv4MappedAddress()) {
    ip = (ip as ipaddr.IPv6).toIPv4Address();
  }
  return ip.range() === "unicast";
}

/** Throws unless the URL is plain http(s) to a host that could be public. */
export function assertFetchableUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw errors.blockedAddress(raw, "not a valid URL");
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw errors.blockedAddress(raw, `scheme ${url.protocol} is not allowed`);
  }
  if (url.username || url.password) {
    throw errors.blockedAddress(raw, "URLs with credentials are not allowed");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (ipaddr.isValid(host) && !isPublicAddress(host)) {
    throw errors.blockedAddress(raw, "address is private, loopback or link-local");
  }
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".internal")) {
    throw errors.blockedAddress(raw, "host is local");
  }
  return url;
}

// Checked when the socket connects, so the address fetched is the address checked.
const guardedLookup: LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (err, addresses) => {
    if (err) return callback(err, "", 4);
    const list = Array.isArray(addresses) ? addresses : [addresses];
    const bad = list.find((a) => !isPublicAddress(a.address));
    if (bad) {
      const e = new Error(`blocked non-public address ${bad.address}`) as NodeJS.ErrnoException;
      e.code = "EBLOCKED";
      return callback(e, "", 4);
    }
    if (options.all) return callback(null, list as never, 4);
    callback(null, list[0].address, list[0].family);
  });
};

const agent = new Agent({ connect: { lookup: guardedLookup }, connections: 4 });

export interface FetchedPage {
  finalUrl: string;
  status: number;
  contentType: string;
  body: string;
}

export type PageFetcher = (url: string) => Promise<FetchedPage>;

/** Fetch a public page safely. Throws named research errors only. */
export const guardedFetchPage: PageFetcher = async (startUrl) => {
  let current = assertFetchableUrl(startUrl);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    let res: Awaited<ReturnType<typeof undiciFetch>>;
    try {
      res = await undiciFetch(current, {
        dispatcher: agent,
        redirect: "manual",
        signal: AbortSignal.timeout(TIMEOUT_MS),
        headers: { "user-agent": USER_AGENT, accept: "text/html,text/plain;q=0.9,*/*;q=0.1" },
      });
    } catch (cause) {
      const code = (cause as { cause?: { code?: string } })?.cause?.code;
      if (code === "EBLOCKED") {
        throw errors.blockedAddress(current.href, "host resolves to a non-public address");
      }
      throw errors.fetchStatus(current.href, 504);
    }

    if (res.status >= 300 && res.status < 400) {
      const location = res.headers.get("location");
      await res.body?.cancel();
      if (!location) throw errors.fetchStatus(current.href, res.status);
      current = assertFetchableUrl(new URL(location, current).href);
      continue;
    }

    const contentType = res.headers.get("content-type") ?? "";
    if (res.ok && !/^text\/|application\/(xhtml|json)/i.test(contentType)) {
      await res.body?.cancel();
      throw errors.unsupportedContent(current.href, `content type ${contentType || "unknown"}`);
    }
    const body = await readCapped(res, current.href);
    return { finalUrl: current.href, status: res.status, contentType, body };
  }
  throw errors.unsupportedContent(startUrl, "too many redirects");
};

async function readCapped(res: { body: unknown }, url: string) {
  if (!res.body) return "";
  const reader = (res.body as ReadableStream<Uint8Array>).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BYTES) {
      await reader.cancel();
      throw errors.unsupportedContent(url, `larger than ${MAX_BYTES} bytes`);
    }
    chunks.push(value);
  }
  return Buffer.concat(chunks).toString("utf8");
}
