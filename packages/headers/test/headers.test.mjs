import { test, describe } from "node:test";
import assert from "node:assert/strict";
import buildHeadersDefault, {
  buildHeaders,
  serializeCsp,
  serializePermissionsPolicy,
  DEFAULT_PERMISSIONS_POLICY,
  DEFAULT_CSP_DIRECTIVES,
} from "../dist/index.js";

const get = (headers, key) => headers.find((h) => h.key === key)?.value;
const has = (headers, key) => headers.some((h) => h.key === key);

describe("the strict default", () => {
  const h = buildHeaders();

  test("is a non-empty { key, value }[]", () => {
    assert.ok(Array.isArray(h) && h.length > 0);
    assert.ok(h.every((x) => typeof x.key === "string" && typeof x.value === "string"));
  });

  test("the default export is buildHeaders", () => {
    assert.equal(buildHeadersDefault, buildHeaders);
  });

  test("sets the static headers", () => {
    assert.equal(get(h, "Strict-Transport-Security"), "max-age=63072000; includeSubDomains; preload");
    assert.equal(get(h, "X-Content-Type-Options"), "nosniff");
    assert.equal(get(h, "X-Frame-Options"), "DENY");
    assert.equal(get(h, "Referrer-Policy"), "strict-origin-when-cross-origin");
    assert.equal(get(h, "X-DNS-Prefetch-Control"), "off");
  });

  test("emits the headers in a fixed order", () => {
    assert.deepEqual(
      h.map((x) => x.key),
      [
        "Strict-Transport-Security",
        "X-Content-Type-Options",
        "X-Frame-Options",
        "Referrer-Policy",
        "Permissions-Policy",
        "X-DNS-Prefetch-Control",
        "Content-Security-Policy",
      ],
    );
  });

  // Pinned by value. A loop over the constant's own keys would stay green if a feature were deleted from it.
  test("the default Permissions-Policy denies the sensitive set, verbatim", () => {
    assert.deepEqual(DEFAULT_PERMISSIONS_POLICY, {
      camera: [],
      microphone: [],
      geolocation: [],
      payment: [],
      usb: [],
      magnetometer: [],
      accelerometer: [],
      gyroscope: [],
    });
  });

  test("the emitted Permissions-Policy is the constant, every feature denied", () => {
    const pp = get(h, "Permissions-Policy");
    for (const feature of Object.keys(DEFAULT_PERMISSIONS_POLICY)) {
      assert.match(pp, new RegExp(`${feature}=\\(\\)`));
    }
    assert.equal(pp, serializePermissionsPolicy(DEFAULT_PERMISSIONS_POLICY));
    assert.equal(
      pp,
      "camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), accelerometer=(), gyroscope=()",
    );
  });

  test("a CSP is on by default; CORS and X-Robots-Tag are off", () => {
    assert.ok(has(h, "Content-Security-Policy"));
    assert.equal(has(h, "Access-Control-Allow-Origin"), false);
    assert.equal(has(h, "X-Robots-Tag"), false);
  });

  // Pinned by value: presence checks alone would let a CSP downgrade (dropping frame-ancestors, widening to *) pass.
  test("the default CSP directives, verbatim", () => {
    assert.deepEqual(DEFAULT_CSP_DIRECTIVES, {
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
  });

  test("the emitted CSP carries the deny directives and is the constant verbatim", () => {
    const csp = get(h, "Content-Security-Policy");
    for (const token of [
      "default-src 'self'",
      "object-src 'none'", // plugin and embed injection
      "frame-ancestors 'none'", // clickjacking
      "base-uri 'self'",
      "form-action 'self'",
      "upgrade-insecure-requests",
    ]) {
      assert.ok(csp.includes(token), `default CSP missing: ${token}`);
    }
    assert.equal(csp, serializeCsp(DEFAULT_CSP_DIRECTIVES));
  });
});

describe("overriding a slice", () => {
  test("a merge keeps the features it doesn't name denied", () => {
    const h = buildHeaders({
      permissionsPolicy: { camera: ["self"], microphone: ["self"] },
      csp: false,
      xRobotsTag: "noindex, nofollow",
    });
    assert.equal(has(h, "Content-Security-Policy"), false);
    assert.equal(get(h, "X-Robots-Tag"), "noindex, nofollow");
    const pp = get(h, "Permissions-Policy");
    assert.match(pp, /camera=\(self\)/);
    assert.match(pp, /microphone=\(self\)/);
    assert.match(pp, /payment=\(\)/);
  });

  test("replace sets exactly the features it names", () => {
    const h = buildHeaders({
      permissionsPolicy: { replace: { camera: ["self"], microphone: ["self"], geolocation: [] } },
      csp: false,
    });
    assert.equal(get(h, "Permissions-Policy"), "camera=(self), microphone=(self), geolocation=()");
  });

  test("a CSP merge changes only the directive it names", () => {
    const csp = get(
      buildHeaders({ csp: { "script-src": [...DEFAULT_CSP_DIRECTIVES["script-src"], "'unsafe-eval'"] } }),
      "Content-Security-Policy",
    );
    assert.equal(csp, serializeCsp({ ...DEFAULT_CSP_DIRECTIVES, "script-src": ["'self'", "'unsafe-inline'", "'unsafe-eval'"] }));
  });
});

describe("CORS", () => {
  test("an origin string adds Access-Control-Allow-Origin and Vary: Origin", () => {
    const h = buildHeaders({ cors: "https://app.example.com" });
    assert.equal(get(h, "Access-Control-Allow-Origin"), "https://app.example.com");
    assert.equal(get(h, "Vary"), "Origin");
  });

  test("vary: false omits Vary", () => {
    const h = buildHeaders({ cors: { origin: "https://x.example.com", vary: false } });
    assert.equal(get(h, "Access-Control-Allow-Origin"), "https://x.example.com");
    assert.equal(has(h, "Vary"), false);
  });
});

describe("false omits a header", () => {
  test("hsts, csp and permissionsPolicy", () => {
    const h = buildHeaders({ hsts: false, csp: false, permissionsPolicy: false });
    assert.equal(has(h, "Strict-Transport-Security"), false);
    assert.equal(has(h, "Content-Security-Policy"), false);
    assert.equal(has(h, "Permissions-Policy"), false);
  });

  test("every optional header off leaves nothing", () => {
    const h = buildHeaders({
      hsts: false,
      contentTypeOptions: false,
      frameOptions: false,
      referrerPolicy: false,
      dnsPrefetchControl: false,
      permissionsPolicy: false,
      csp: false,
    });
    assert.deepEqual(h, []);
  });
});

describe("serializers", () => {
  test("serializeCsp: tokens after the name; an empty array renders the bare directive", () => {
    assert.equal(
      serializeCsp({ "default-src": ["'self'"], "upgrade-insecure-requests": [] }),
      "default-src 'self'; upgrade-insecure-requests",
    );
  });

  test("serializePermissionsPolicy: deny, self, wildcard, quoted origin", () => {
    assert.equal(serializePermissionsPolicy({ camera: [], microphone: ["self"] }), "camera=(), microphone=(self)");
    assert.equal(serializePermissionsPolicy({ fullscreen: ["*"] }), "fullscreen=*");
    assert.equal(serializePermissionsPolicy({ geolocation: ["https://x.com"] }), 'geolocation=("https://x.com")');
  });
});

// `{ "connect-src": isDev ? [...] : undefined }` is the natural shape for a conditional directive. It must mean the
// key wasn't named: copied over the default, it rendered a bare `script-src`, which blocks every script and still
// answers 200, and an undefined Permissions feature threw at boot.
describe("an undefined override value keeps the strict default", () => {
  test("csp: an undefined directive doesn't render a bare, block-all directive", () => {
    const csp = get(buildHeaders({ csp: { "script-src": undefined } }), "Content-Security-Policy");
    const directive = csp
      .split(";")
      .map((part) => part.trim())
      .find((part) => part.startsWith("script-src"));
    assert.equal(directive, "script-src 'self' 'unsafe-inline'");
    assert.equal(csp, serializeCsp(DEFAULT_CSP_DIRECTIVES));
  });

  test("permissionsPolicy: an undefined feature doesn't throw, and stays denied", () => {
    const pp = get(buildHeaders({ permissionsPolicy: { camera: undefined } }), "Permissions-Policy");
    assert.equal(pp, serializePermissionsPolicy(DEFAULT_PERMISSIONS_POLICY));
  });

  test("undefined is dropped on the replace path too", () => {
    const pp = get(
      buildHeaders({ permissionsPolicy: { replace: { camera: ["self"], usb: undefined } } }),
      "Permissions-Policy",
    );
    assert.equal(pp, "camera=(self)");
  });

  test("an empty array still means something and is kept", () => {
    assert.equal(
      serializeCsp({ "default-src": ["'self'"], "upgrade-insecure-requests": [] }),
      "default-src 'self'; upgrade-insecure-requests",
    );
    const pp = get(buildHeaders({ permissionsPolicy: { camera: [] } }), "Permissions-Policy");
    assert.ok(pp.startsWith("camera=()"));
  });
});

// Every merge result shares the defaults' arrays, so one push anywhere in a process would widen every later CSP.
describe("the exported defaults are frozen", () => {
  test("both defaults and their arrays", () => {
    assert.ok(Object.isFrozen(DEFAULT_CSP_DIRECTIVES));
    assert.ok(Object.isFrozen(DEFAULT_PERMISSIONS_POLICY));
    for (const tokens of Object.values(DEFAULT_CSP_DIRECTIVES)) assert.ok(Object.isFrozen(tokens));
    for (const origins of Object.values(DEFAULT_PERMISSIONS_POLICY)) assert.ok(Object.isFrozen(origins));
  });

  test("a mutation attempt throws and can't widen a later call", () => {
    assert.throws(() => DEFAULT_CSP_DIRECTIVES["script-src"].push("https://evil.example"));
    assert.throws(() => {
      DEFAULT_PERMISSIONS_POLICY.camera = ["*"];
    });
    assert.ok(!get(buildHeaders(), "Content-Security-Policy").includes("evil.example"));
    assert.ok(get(buildHeaders(), "Permissions-Policy").startsWith("camera=()"));
  });
});

// Rendered bare, a mistyped directive blocks every script; a mistyped allowlist used to throw an opaque
// "reading 'length'". Both now fail at config time, naming the key.
describe("a wrongly typed value fails loudly, naming the key", () => {
  test("a CSP directive that isn't an array", () => {
    assert.throws(
      () => serializeCsp({ "script-src": "'self'" }),
      (err) => {
        assert.ok(err instanceof TypeError);
        assert.match(err.message, /^\[@gravixar\/headers\] /);
        assert.match(err.message, /script-src/);
        return true;
      },
    );
  });

  test("an allowlist that isn't an array", () => {
    assert.throws(
      () => serializePermissionsPolicy({ camera: "self" }),
      (err) => {
        assert.ok(err instanceof TypeError);
        assert.match(err.message, /^\[@gravixar\/headers\] /);
        assert.match(err.message, /camera/);
        return true;
      },
    );
  });

  test("through buildHeaders too", () => {
    assert.throws(() => buildHeaders({ csp: { "img-src": null } }), /img-src/);
    assert.throws(() => buildHeaders({ permissionsPolicy: { replace: { usb: 1 } } }), /usb/);
  });
});
