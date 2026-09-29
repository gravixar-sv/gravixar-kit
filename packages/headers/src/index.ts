// Security headers for a Next.js `headers()` entry, from a typed policy with a strict default.
//
//   import { buildHeaders } from "@gravixar/headers";
//   const nextConfig = {
//     async headers() {
//       return [{ source: "/:path*", headers: buildHeaders() }];
//     },
//   };
//
// The mechanism is shared and the policy is each site's: a site overrides only the slice its threat model needs.

/** A header object, as Next.js reads it from a `headers()` entry. */
export interface HeaderObject {
  key: string;
  value: string;
}

/** A CSP directive name mapped to its tokens. An empty array renders the bare directive (`upgrade-insecure-requests`). */
export type CspDirectives = Record<string, readonly string[]>;

/**
 * A Permissions-Policy feature mapped to its allowlist.
 * `[]` → `feature=()`, `["self"]` → `feature=(self)`, `["*"]` → `feature=*`, `["https://x"]` → `feature=("https://x")`.
 */
export type PermissionsPolicyMap = Record<string, readonly string[]>;

/** Replaces the default wholesale instead of merging onto it. */
export interface ReplaceWrapper<T> {
  replace: T;
}

/** An origin, or `{ origin, vary? }`. */
export type CorsOption = string | { origin: string; vary?: boolean };

export interface HeadersPolicy {
  /** Strict-Transport-Security. Default `"max-age=63072000; includeSubDomains; preload"`; `false` omits it. */
  hsts?: string | false;
  /** `X-Content-Type-Options: nosniff`. Default `true`; `false` omits it. */
  contentTypeOptions?: boolean;
  /** X-Frame-Options. Default `"DENY"`; `false` omits it. */
  frameOptions?: string | false;
  /** Referrer-Policy. Default `"strict-origin-when-cross-origin"`; `false` omits it. */
  referrerPolicy?: string | false;
  /** `X-DNS-Prefetch-Control: off`. Default `true`; `false` omits it. */
  dnsPrefetchControl?: boolean;
  /** Permissions-Policy. An object merges onto the deny-all default, `{ replace }` sets it wholesale, `false` omits it. */
  permissionsPolicy?: PermissionsPolicyMap | ReplaceWrapper<PermissionsPolicyMap> | false;
  /** Content-Security-Policy. An object merges onto the strict default, `{ replace }` sets it wholesale, `false` omits it. */
  csp?: CspDirectives | ReplaceWrapper<CspDirectives> | false;
  /** Access-Control-Allow-Origin, with `Vary: Origin` unless `vary: false`. Off by default. */
  cors?: CorsOption | false;
  /** X-Robots-Tag, e.g. `"noindex, nofollow"`. Off by default. */
  xRobotsTag?: string | false;
}

const PREFIX = "[@gravixar/headers]";

/**
 * Freezes a defaults object and each of its arrays. Every merge result shares these arrays, so one
 * `DEFAULT_CSP_DIRECTIVES["script-src"].push(...)` anywhere in a process would widen every later call's CSP. A
 * mutation attempt throws instead, because ES modules are always strict mode.
 */
function deepFreeze<T extends Record<string, readonly string[]>>(obj: T): Readonly<T> {
  for (const value of Object.values(obj)) {
    if (Array.isArray(value)) Object.freeze(value);
  }
  return Object.freeze(obj);
}

/**
 * Drops keys whose value is `undefined`, so `{ "connect-src": isDev ? [...] : undefined }` keeps the default. Copied
 * over it, `undefined` rendered a bare `script-src`, which blocks every script and still answers 200, and a Permissions
 * feature set to `undefined` threw at boot. `[]` is kept: it means a bare directive, or a denied feature.
 */
function stripUndefined(obj: unknown): unknown {
  if (!obj || typeof obj !== "object") return obj;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) {
    if (v !== undefined) out[k] = v;
  }
  return out;
}

/** An override merged onto the defaults, or `{ replace }` instead of them. */
function resolve(override: unknown, defaults: Readonly<Record<string, readonly string[]>>): unknown {
  const o = override as { replace?: unknown } | null | undefined;
  return o && o.replace ? stripUndefined(o.replace) : { ...defaults, ...(stripUndefined(o) as object | null) };
}

/**
 * The default CSP. It allows inline scripts and styles, which Next.js needs without nonces, and Supabase storage
 * and realtime (`https://*.supabase.co`, `wss://*.supabase.co`) for images and connections. Development can widen
 * `script-src` with `'unsafe-eval'` for Fast Refresh through the `csp` override.
 */
export const DEFAULT_CSP_DIRECTIVES: Readonly<CspDirectives> = deepFreeze({
  "default-src": ["'self'"],
  "script-src": ["'self'", "'unsafe-inline'"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "font-src": ["'self'", "data:"],
  "img-src": ["'self'", "data:", "blob:", "https://*.supabase.co"],
  "connect-src": ["'self'", "https://*.supabase.co", "wss://*.supabase.co"],
  "object-src": ["'none'"],
  "base-uri": ["'self'"],
  "form-action": ["'self'"],
  "frame-ancestors": ["'none'"],
  "upgrade-insecure-requests": [],
});

/** The default Permissions-Policy: every sensitive feature denied. */
export const DEFAULT_PERMISSIONS_POLICY: Readonly<PermissionsPolicyMap> = deepFreeze({
  camera: [],
  microphone: [],
  geolocation: [],
  payment: [],
  usb: [],
  magnetometer: [],
  accelerometer: [],
  gyroscope: [],
});

const DEFAULT_HSTS = "max-age=63072000; includeSubDomains; preload";
const DEFAULT_REFERRER_POLICY = "strict-origin-when-cross-origin";
const DEFAULT_FRAME_OPTIONS = "DENY";

/**
 * Renders CSP directives as a header value: `{ "default-src": ["'self'"], "upgrade-insecure-requests": [] }` →
 * `"default-src 'self'; upgrade-insecure-requests"`. A directive that isn't an array throws, naming it: rendered bare,
 * a mistyped `script-src` would block every script on the page.
 */
export function serializeCsp(directives: CspDirectives): string {
  return Object.entries(directives as Record<string, unknown>)
    .map(([k, v]) => {
      if (!Array.isArray(v)) {
        throw new TypeError(
          `${PREFIX} CSP directive "${k}" must be an array of tokens; received ${typeof v}. Use [] for a bare ` +
            `directive (e.g. upgrade-insecure-requests), or omit the key to keep the default.`,
        );
      }
      return v.length ? `${k} ${v.join(" ")}` : k;
    })
    .join("; ");
}

/** One allowlist: `[]` → `()`, `["self"]` → `(self)`, `["*"]` → `*`, origins quoted: `("https://x")`. */
function serializeAllowlist(feature: string, origins: unknown): string {
  if (!Array.isArray(origins)) {
    throw new TypeError(
      `${PREFIX} Permissions-Policy feature "${feature}" must be an array of origins; received ${typeof origins}. ` +
        `Use [] to deny (feature=()), or omit the key to keep the default.`,
    );
  }
  if (origins.length === 1 && origins[0] === "*") return "*";
  const tokens = origins.map((o) => (o === "self" || o === "src" ? o : `"${o}"`));
  return `(${tokens.join(" ")})`;
}

/** Renders a Permissions-Policy as a header value: `{ camera: [], microphone: ["self"] }` → `"camera=(), microphone=(self)"`. */
export function serializePermissionsPolicy(policy: PermissionsPolicyMap): string {
  return Object.entries(policy as Record<string, unknown>)
    .map(([feature, origins]) => `${feature}=${serializeAllowlist(feature, origins)}`)
    .join(", ");
}

/**
 * The `{ key, value }[]` for a Next.js `headers()` entry. With no argument, the strict default: HSTS with preload,
 * `nosniff`, `X-Frame-Options: DENY`, `strict-origin-when-cross-origin`, a deny-all Permissions-Policy,
 * `X-DNS-Prefetch-Control: off` and the default CSP.
 *
 * - `csp` and `permissionsPolicy` objects are merged key by key onto the defaults, so a key you don't name keeps its
 *   strict value. `{ replace: {...} }` sets the header wholesale, `false` omits it.
 * - `hsts`, `frameOptions` and `referrerPolicy` take a string to replace the value, or `false` to omit the header.
 * - `cors` and `xRobotsTag` are off by default.
 *
 * Headers come out in a fixed order: Strict-Transport-Security, X-Content-Type-Options, X-Frame-Options,
 * Referrer-Policy, Permissions-Policy, X-DNS-Prefetch-Control, X-Robots-Tag, Content-Security-Policy,
 * Access-Control-Allow-Origin, Vary.
 */
export function buildHeaders(policy: HeadersPolicy = {}): HeaderObject[] {
  const {
    hsts = DEFAULT_HSTS,
    contentTypeOptions = true,
    frameOptions = DEFAULT_FRAME_OPTIONS,
    referrerPolicy = DEFAULT_REFERRER_POLICY,
    dnsPrefetchControl = true,
    permissionsPolicy = {},
    csp = {},
    cors = false,
    xRobotsTag = false,
  } = policy;

  const headers: HeaderObject[] = [];

  if (hsts !== false) headers.push({ key: "Strict-Transport-Security", value: hsts });
  if (contentTypeOptions !== false) headers.push({ key: "X-Content-Type-Options", value: "nosniff" });
  if (frameOptions !== false) headers.push({ key: "X-Frame-Options", value: frameOptions });
  if (referrerPolicy !== false) headers.push({ key: "Referrer-Policy", value: referrerPolicy });

  if (permissionsPolicy !== false) {
    const resolved = resolve(permissionsPolicy, DEFAULT_PERMISSIONS_POLICY) as PermissionsPolicyMap;
    headers.push({ key: "Permissions-Policy", value: serializePermissionsPolicy(resolved) });
  }

  if (dnsPrefetchControl !== false) headers.push({ key: "X-DNS-Prefetch-Control", value: "off" });

  if (xRobotsTag) headers.push({ key: "X-Robots-Tag", value: xRobotsTag });

  if (csp !== false) {
    const resolved = resolve(csp, DEFAULT_CSP_DIRECTIVES) as CspDirectives;
    headers.push({ key: "Content-Security-Policy", value: serializeCsp(resolved) });
  }

  if (cors) {
    const origin = typeof cors === "string" ? cors : cors.origin;
    const vary = typeof cors === "string" ? true : cors.vary !== false;
    if (origin) {
      headers.push({ key: "Access-Control-Allow-Origin", value: origin });
      if (vary) headers.push({ key: "Vary", value: "Origin" });
    }
  }

  return headers;
}

export default buildHeaders;
