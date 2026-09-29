// Checked by `pnpm typecheck` against the built declarations, as a consumer sees them. Each @ts-expect-error is a
// negative test: if the types stop rejecting that line, the directive goes unused and the typecheck fails.
import buildHeadersDefault, {
  buildHeaders,
  serializeCsp,
  serializePermissionsPolicy,
  DEFAULT_CSP_DIRECTIVES,
  DEFAULT_PERMISSIONS_POLICY,
  type CorsOption,
  type CspDirectives,
  type HeaderObject,
  type HeadersPolicy,
  type PermissionsPolicyMap,
  type ReplaceWrapper,
} from "../dist/index.js";

const strict: HeaderObject[] = buildHeaders();
const same: HeaderObject[] = buildHeadersDefault({});

// A private dashboard: same-origin camera and microphone, no CSP, never indexed.
buildHeaders({
  permissionsPolicy: { camera: ["self"], microphone: ["self"] },
  csp: false,
  cors: false,
  xRobotsTag: "noindex, nofollow",
});
buildHeaders({ permissionsPolicy: { replace: { camera: ["self"], microphone: ["self"], geolocation: [] } } });

buildHeaders({ cors: "https://app.example.com" });
buildHeaders({ cors: { origin: "https://app.example.com", vary: false } });

// Widening from the frozen default, for development.
buildHeaders({ csp: { "script-src": [...(DEFAULT_CSP_DIRECTIVES["script-src"] ?? []), "'unsafe-eval'"] } });
buildHeaders({ csp: { ...DEFAULT_CSP_DIRECTIVES, "connect-src": ["'self'"] } });
buildHeaders({ csp: { replace: { "default-src": ["'self'"] } } });

// The README's override, with a development-only directive left out rather than set to undefined.
declare const dev: boolean;
buildHeaders({
  csp: {
    "script-src": ["'self'", "'unsafe-inline'", "https://plausible.io"],
    ...(dev ? { "connect-src": ["'self'", "ws://localhost:3000"] } : {}),
  },
  permissionsPolicy: { camera: ["self"] },
  xRobotsTag: "noindex, nofollow",
});
buildHeaders({ frameOptions: false, csp: { "frame-ancestors": ["https://parent.example.com"] } });

const policy: HeadersPolicy = { hsts: false, frameOptions: "SAMEORIGIN", contentTypeOptions: true };
buildHeaders(policy);

const csp: string = serializeCsp(DEFAULT_CSP_DIRECTIVES);
const pp: string = serializePermissionsPolicy(DEFAULT_PERMISSIONS_POLICY);

const directives: CspDirectives = { "default-src": ["'self'"] };
const features: PermissionsPolicyMap = { camera: [] };
const wrapped: ReplaceWrapper<CspDirectives> = { replace: directives };
const cors: CorsOption = { origin: "https://app.example.com" };
void [strict, same, csp, pp, features, wrapped, cors];

// @ts-expect-error an undefined directive value must not typecheck
buildHeaders({ csp: { "script-src": undefined } });

// @ts-expect-error an undefined Permissions-Policy value must not typecheck
buildHeaders({ permissionsPolicy: { camera: undefined } });

// @ts-expect-error a bare string is not an allowlist
serializePermissionsPolicy({ camera: "self" });

// @ts-expect-error a bare string is not a CSP token list
serializeCsp({ "script-src": "'self'" });

// @ts-expect-error the defaults are read-only
DEFAULT_CSP_DIRECTIVES["script-src"] = ["*"];

// @ts-expect-error nosniff is on or off, not a string
buildHeaders({ contentTypeOptions: "nosniff" });

// @ts-expect-error a CORS object needs an origin
buildHeaders({ cors: { vary: false } });

// @ts-expect-error hsts can't be switched on with true
buildHeaders({ hsts: true });
