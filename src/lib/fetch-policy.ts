import { lookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { createHash } from "node:crypto";
import ipaddr from "ipaddr.js";
import { load } from "cheerio";
import { franc } from "franc-min";

export class AnalysisError extends Error {
  readonly status: number;
  constructor(message: string, status = 400, cause?: unknown) {
    // `cause` carries diagnostics for operators and evals; only `message` is ever shown to users.
    super(message, cause === undefined ? undefined : { cause });
    this.status = status;
  }
}

export function isPublicAddress(address: string) {
  try {
    return ipaddr.process(address).range() === "unicast";
  } catch {
    return false;
  }
}

export function validatePolicyUrl(value: string) {
  let url: URL;
  try { url = new URL(value); } catch { throw new AnalysisError("Enter a complete privacy-policy URL, including https://."); }
  if (!(["https:", "http:"].includes(url.protocol)) || url.username || url.password || url.port || url.search || value.length > 2000) {
    throw new AnalysisError("Use a public HTTP(S) URL with no credentials, query parameters, or custom port.");
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || !host.includes(".")) {
    throw new AnalysisError("Only public website addresses are allowed.");
  }
  if (ipaddr.isValid(host) && !isPublicAddress(host)) throw new AnalysisError("Private and reserved addresses are not allowed.");
  url.hash = "";
  return url;
}

export async function resolvePublicDestination(host: string, resolve = (hostname: string) => lookup(hostname, { all: true, verbatim: true })) {
  if (ipaddr.isValid(host)) {
    if (!isPublicAddress(host)) throw new AnalysisError("Private and reserved addresses are not allowed.");
    return { address: host, family: ipaddr.parse(host).kind() === "ipv4" ? 4 : 6 };
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const addresses = await Promise.race([
      resolve(host),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new AnalysisError("Website DNS lookup timed out.", 408)), 5000); }),
    ]);
    if (!addresses.length || addresses.some(({ address }) => !isPublicAddress(address))) throw new AnalysisError("This website resolves to a private or reserved address.");
    return addresses[0];
  } finally { if (timer) clearTimeout(timer); }
}

async function fetchPage(url: URL, signal: AbortSignal): Promise<{ html?: string; redirect?: string }> {
  const destination = await resolvePublicDestination(url.hostname.replace(/^\[|\]$/g, ""));
  if (signal.aborted) throw new AnalysisError("Analysis was cancelled.", 408);
  return new Promise((resolve, reject) => {
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;
    const request = transport(url, {
      agent: false,
      family: destination.family,
      signal,
      lookup: (_hostname, _options, callback) => callback(null, destination.address, destination.family),
      headers: { "User-Agent": "PrivAudit/1.0 (privacy-policy analysis)", Accept: "text/html,application/xhtml+xml", "Accept-Encoding": "identity" },
    }, (response) => {
      const status = response.statusCode ?? 500;
      if ([301, 302, 303, 307, 308].includes(status) && response.headers.location) {
        response.destroy();
        resolve({ redirect: response.headers.location });
        return;
      }
      if (status < 200 || status >= 300) {
        response.destroy();
        reject(new AnalysisError(`The website returned HTTP ${status}. Try a direct, publicly accessible policy URL.`));
        return;
      }
      if (!/^(text\/html|application\/xhtml\+xml)\b/i.test(response.headers["content-type"] ?? "") || (response.headers["content-encoding"] && response.headers["content-encoding"] !== "identity")) {
        response.destroy();
        reject(new AnalysisError("Only uncompressed HTML privacy-policy pages are supported. PDFs and downloads are not supported yet."));
        return;
      }
      const chunks: Buffer[] = [];
      let size = 0;
      response.on("data", (chunk: Buffer) => {
        size += chunk.length;
        if (size > 1_000_000) {
          response.destroy(new AnalysisError("This page is too large to analyze safely."));
          return;
        }
        chunks.push(chunk);
      });
      response.on("end", () => resolve({ html: Buffer.concat(chunks).toString("utf8") }));
      response.on("error", reject);
    });
    request.setTimeout(12000, () => request.destroy(new AnalysisError("The website took too long to respond.", 408)));
    request.on("error", reject);
    request.end();
  });
}

const PRIVACY_TERMS = /\b(?:personal (?:data|information)|privacy|cookies?|third[- ]part(?:y|ies)|data protection|consent|retention|retain)\b/gi;
function privacySignal(text: string) { return text.match(PRIVACY_TERMS)?.length ?? 0; }

function domText(document: ReturnType<typeof load>, root: ReturnType<ReturnType<typeof load>>) {
  document("br").replaceWith("\n");
  document("p,h1,h2,h3,h4,li,section,div,article,main").append("\n");
  return root.text().replace(/[\t\r ]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

function matchingBracket(text: string, start: number) {
  let depth = 0;
  let inString = false;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (inString) {
      if (char === "\\") index++;
      else if (char === "\"") inString = false;
    } else if (char === "\"") inString = true;
    else if (char === "{" || char === "[") depth++;
    else if ((char === "}" || char === "]") && --depth === 0) return index;
  }
  return -1;
}

// JSON embedded in inline scripts: JSON script tags and `name = {...}` style assignments used for client-side rendering.
function embeddedJson(script: string) {
  const values: unknown[] = [];
  const trimmed = script.trim();
  if (/^[{[]/.test(trimmed)) {
    try { return [JSON.parse(trimmed) as unknown]; } catch { /* not a pure JSON script; scan for assignments */ }
  }
  const assignment = /=\s*(?=[{[])/g;
  for (let match = assignment.exec(script); match; match = assignment.exec(script)) {
    const start = match.index + match[0].length;
    const end = matchingBracket(script, start);
    if (end < 0) continue;
    try {
      values.push(JSON.parse(script.slice(start, end + 1)));
      assignment.lastIndex = end + 1;
    } catch { /* JavaScript object literal rather than JSON */ }
  }
  return values;
}

function isContentString(value: string) {
  return /[A-Za-z]/.test(value) && !/^https?:\/\/\S+$/.test(value) && !/^[a-z0-9_\-./:#?=&]+$/.test(value);
}

function contentText(value: string) {
  if (/<[a-z][^>]*>/i.test(value)) {
    const fragment = load(value);
    return domText(fragment, fragment.root());
  }
  return value
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+/gm, "")
    .replace(/^[ \t]*[*-][ \t]+/gm, "")
    .replace(/[\t\r ]+/g, " ").replace(/\n\s*\n/g, "\n").trim();
}

// Locates the policy inside embedded page data: the smallest subtree holding most of the privacy language,
// which excludes unrelated configuration (offers, menus, settings) stored alongside it.
function embeddedPolicyText(scripts: string[]) {
  const signals = new Map<unknown, number>();
  const signal = (value: unknown): number => {
    if (typeof value === "string") return isContentString(value) && value.split(/\s+/).length >= 8 ? privacySignal(value) : 0;
    if (!value || typeof value !== "object") return 0;
    if (!signals.has(value)) signals.set(value, Object.values(value).reduce((sum: number, child) => sum + signal(child), 0));
    return signals.get(value)!;
  };
  let node = scripts.flatMap(embeddedJson).reduce<unknown>((best, value) => signal(value) > signal(best) ? value : best, null);
  if (!signal(node)) return null;
  while (node && typeof node === "object") {
    const total = signal(node);
    const child = Object.values(node).find((value) => value && typeof value === "object" && signal(value) >= total * 0.9);
    if (child === undefined) break;
    node = child;
  }
  const lines: string[] = [];
  const collect = (value: unknown) => {
    if (typeof value === "string") { if (isContentString(value)) lines.push(contentText(value)); }
    else if (value && typeof value === "object") Object.values(value).forEach(collect);
  };
  collect(node);
  return lines.filter(Boolean).join("\n");
}

export function extractPolicyText(html: string) {
  const document = load(html);
  const inlineScripts = document("script:not([src])").map((_, element) => document(element).text()).get();
  document("header, footer").filter((_, element) => {
    const block = document(element);
    if (!block.parents("main, article").length) return true;
    const linkOnlyItems = block.find("li").filter((_, item) => {
      const text = document(item).text().replace(/\s+/g, "");
      return text.length > 0 && document(item).find("a").text().replace(/\s+/g, "") === text;
    });
    // Inside the main content, a header/footer is policy content only when it is headed prose, not a link directory.
    return !block.find("h1, h2, h3, h4, h5, h6").length || linkOnlyItems.length >= 3;
  }).remove();
  document("script,style,noscript,svg,nav,form,iframe").remove();
  let text = domText(document, document("body"));
  // Client-rendered pages ship the policy as data; use it only when the visible HTML holds no policy.
  if (text.length < 500 || privacySignal(text) < 3) {
    const embedded = embeddedPolicyText(inlineScripts);
    if (embedded && embedded.length >= 500 && privacySignal(embedded) >= 3) text = embedded;
  }
  if (text.length < 500) throw new AnalysisError("Not enough policy text was found. JavaScript-only and login-required pages are not supported.");
  if (Buffer.byteLength(text, "utf8") > 320_000) throw new AnalysisError("This policy exceeds the 320,000-byte analysis limit. No partial score has been produced.");
  if (franc(text) !== "eng") throw new AnalysisError("Version 1 supports English-language policies only.");
  return text;
}

export async function downloadPolicyPage(value: string, signal: AbortSignal) {
  const original = validatePolicyUrl(value);
  let url = original;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const page = await fetchPage(url, signal);
    if (page.redirect) {
      url = validatePolicyUrl(new URL(page.redirect, url).href);
      continue;
    }
    return { url: original.href, finalUrl: url.href, html: page.html ?? "", redirects };
  }
  throw new AnalysisError("Too many redirects. Paste the final privacy-policy URL instead.");
}

export async function fetchPolicy(value: string, signal: AbortSignal) {
  const page = await downloadPolicyPage(value, signal);
  const text = extractPolicyText(page.html);
  return { url: page.url, finalUrl: page.finalUrl, text, hash: createHash("sha256").update(text).digest("hex") };
}