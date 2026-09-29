import type { SubmissionMeta } from "./types.js";

/**
 * Collapses an address to the inbox it reaches. Gmail ignores dots and everything after `+`, so a bot can mint
 * endless unique-looking addresses for one mailbox. For dedupe only: never reject with it, and never store it in
 * place of what the person typed.
 */
export function normalizeEmail(email: string): string {
  const lower = email.trim().toLowerCase();
  const at = lower.lastIndexOf("@");
  if (at < 1) return lower;
  const local = lower.slice(0, at);
  const domain = lower.slice(at + 1);
  if (domain !== "gmail.com" && domain !== "googlemail.com") return lower;
  return `${(local.split("+")[0] ?? "").replace(/\./g, "")}@gmail.com`;
}

/**
 * SHA-256 of the parts joined by `|`, as its first 32 hex characters. A bot replaying one payload makes one id, so
 * a store keyed on it keeps one record. Web Crypto, never `node:crypto`, so no Node builtin can reach a client chunk.
 */
export async function stableId(parts: readonly string[]): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(parts.join("|")));
  return hex(new Uint8Array(digest)).slice(0, 32);
}

/** A random id in the same shape as `stableId`. */
export function randomId(): string {
  return crypto.randomUUID().replaceAll("-", "");
}

function hex(bytes: Uint8Array): string {
  let out = "";
  for (const byte of bytes) out += byte.toString(16).padStart(2, "0");
  return out;
}

export type FormValue = string | File;

/**
 * Turns `FormData` into a plain object for `form.submit`. An absent field is `undefined`, never `null`: a `null`
 * from `fd.get()` once read as a malformed honeypot, and as a timestamp 56 years old. An empty file input (a
 * zero-byte `File`, which browsers send when nothing is chosen) counts as absent. A field listed in `multiple`
 * is always an array. Strings are passed as typed; trimming is the schema's job.
 */
export function fromFormData(
  fd: FormData,
  options: { multiple?: readonly string[] } = {},
): Record<string, FormValue | FormValue[] | undefined> {
  const multiple = new Set(options.multiple ?? []);
  const out: Record<string, FormValue | FormValue[] | undefined> = {};
  for (const key of new Set(fd.keys())) {
    const values = fd.getAll(key).filter((value) => typeof value === "string" || value.size > 0);
    if (multiple.has(key)) out[key] = values;
    else if (values.length > 0) out[key] = values[0];
  }
  for (const key of multiple) out[key] ??= [];
  return out;
}

/** The IP and user agent of a request, from its headers (Next's `await headers()`, or `request.headers`). */
export function metaFromHeaders(headers: { get(name: string): string | null }): SubmissionMeta {
  const meta: SubmissionMeta = {};
  const ip = headers.get("x-forwarded-for")?.split(",")[0]?.trim() || headers.get("x-real-ip")?.trim();
  const userAgent = headers.get("user-agent");
  if (ip) meta.ip = ip;
  if (userAgent) meta.userAgent = userAgent;
  return meta;
}

/** Reads an environment variable where there is one: Node, and the server runtimes that provide `process.env`. */
export function env(name: string): string | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[name];
}

/**
 * Production means a submission that isn't delivered is lost. On Vercel that is `VERCEL_ENV=production` (previews
 * run with `NODE_ENV=production` too, so it can't be used there); elsewhere, `NODE_ENV=production`.
 */
export function isProduction(): boolean {
  const vercel = env("VERCEL_ENV");
  return vercel ? vercel === "production" : env("NODE_ENV") === "production";
}

export function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
