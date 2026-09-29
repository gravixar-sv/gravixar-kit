# @gravixar/headers

Security headers for a Next.js `headers()` entry. With no argument it returns a strict default; a site overrides only
the slice its threat model needs, and every header it doesn't name keeps the strict value.

It is the builder Gravixar's own sites already run, moved here so any site can install it from npm without a token.
A test compares its output with the original's across 85 cases.

## Use

```ts
// next.config.ts
import { buildHeaders } from "@gravixar/headers";

const nextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: buildHeaders() }];
  },
};
export default nextConfig;
```

The default, in the order it is emitted:

| Header | Value |
|---|---|
| Strict-Transport-Security | `max-age=63072000; includeSubDomains; preload` |
| X-Content-Type-Options | `nosniff` |
| X-Frame-Options | `DENY` |
| Referrer-Policy | `strict-origin-when-cross-origin` |
| Permissions-Policy | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()` |
| X-DNS-Prefetch-Control | `off` |
| Content-Security-Policy | `DEFAULT_CSP_DIRECTIVES`, below |

X-Robots-Tag comes after X-DNS-Prefetch-Control, and Access-Control-Allow-Origin and `Vary: Origin` come last, when a
site turns them on.

**Check the CSP before adopting the default.** It allows inline scripts and styles, which Next.js needs without
nonces, and it allows Supabase (`https://*.supabase.co` for images and connections, `wss://*.supabase.co` for
realtime), because the site it came from uses them. A site that loads anything else (analytics, fonts, embeds, a
payment form) has to add those origins, or the browser blocks them.

```text
default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; font-src 'self' data:;
img-src 'self' data: blob: https://*.supabase.co; connect-src 'self' https://*.supabase.co wss://*.supabase.co;
object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'; upgrade-insecure-requests
```

## Override

```ts
const dev = process.env.NODE_ENV === "development";

buildHeaders({
  // Merged onto the default: script-src changes, every other directive stays.
  csp: {
    "script-src": ["'self'", "'unsafe-inline'", "https://plausible.io"],
    ...(dev ? { "connect-src": ["'self'", "ws://localhost:3000"] } : {}),
  },
  // Merged too: camera allowed same-origin, every other feature still denied.
  permissionsPolicy: { camera: ["self"] },
  xRobotsTag: "noindex, nofollow",
});
```

- `csp` and `permissionsPolicy` take an object that is **merged key by key** onto the default, so a key you don't
  name keeps its strict value. A new key is added after the defaults. `{ replace: {...} }` sets the header wholesale
  instead, and `false` omits it.
- The types reject a key set to `undefined`; leave the key out instead, as above. Untyped JavaScript that passes
  `undefined` gets the default for that key, never a bare directive.
- A CSP directive is an array of tokens. `[]` renders the bare directive (`upgrade-insecure-requests`).
- A Permissions-Policy feature is an allowlist: `[]` → `camera=()`, `["self"]` → `camera=(self)`, `["*"]` →
  `camera=*`, and an origin is quoted: `["https://x.com"]` → `camera=("https://x.com")`.
- `hsts`, `frameOptions` and `referrerPolicy` take a string to replace the value, or `false` to omit the header.
  `contentTypeOptions` and `dnsPrefetchControl` take `false` to omit theirs.
- `cors` is off by default. An origin string adds `Access-Control-Allow-Origin` and `Vary: Origin`;
  `{ origin, vary: false }` leaves out `Vary`.
- `xRobotsTag` is off by default. A string adds `X-Robots-Tag`.

To let one site embed the pages, drop `X-Frame-Options` and name the parent in `frame-ancestors`:

```ts
buildHeaders({ frameOptions: false, csp: { "frame-ancestors": ["https://parent.example.com"] } });
```

A directive or allowlist that isn't an array throws a `TypeError` naming the key, so a typo fails `next build` instead
of shipping a CSP that blocks every script.

## Also exported

- `DEFAULT_CSP_DIRECTIVES` and `DEFAULT_PERMISSIONS_POLICY`, frozen: a mutation throws instead of changing every later
  call. Spread them to build on the default: `[...DEFAULT_CSP_DIRECTIVES["script-src"], "'unsafe-eval'"]`.
- `serializeCsp(directives)` and `serializePermissionsPolicy(policy)`, which render a header value.
- The types `HeadersPolicy`, `HeaderObject`, `CspDirectives`, `PermissionsPolicyMap`, `ReplaceWrapper` and
  `CorsOption`.

## License

[MIT](LICENSE)
