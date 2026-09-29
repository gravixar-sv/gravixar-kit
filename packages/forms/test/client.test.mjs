// A client component imports `@gravixar/forms`, so everything that entry reaches ships to the browser. A live site
// once shipped `node:crypto` to the browser on a green build, from a module-level import next to a field name.
// This walks the built entry's module graph, as a bundler would, and fails if it reaches server code.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as client from "../dist/index.js";

const dist = join(dirname(fileURLToPath(import.meta.url)), "..", "dist");

const code = (text) => text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

/** Every module the file reaches through static or dynamic imports and re-exports, with its code (no comments). */
function graph(entry, seen = new Map()) {
  if (seen.has(entry)) return seen;
  const source = code(readFileSync(entry, "utf8"));
  seen.set(entry, source);
  const specifiers = [...source.matchAll(/(?:\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/g)].map((m) => m[1]);
  for (const specifier of specifiers) {
    assert.ok(specifier.startsWith("./"), `${relative(dist, entry)} imports "${specifier}", a module outside the package`);
    graph(join(dirname(entry), specifier), seen);
  }
  return seen;
}

test("the client entry reaches only the field names", () => {
  const modules = graph(join(dist, "index.js"));
  assert.deepEqual([...modules.keys()].map((file) => relative(dist, file)).sort(), ["fields.js", "index.js"]);
});

test("nothing the client entry reaches touches a server API", () => {
  for (const [file, source] of graph(join(dist, "index.js"))) {
    for (const server of ["process", "crypto", "Buffer", "require(", "node:", "resend", "defineForm"]) {
      assert.equal(source.includes(server), false, `${relative(dist, file)} mentions ${server}`);
    }
  }
});

test("the client entry exports the field names a form renders", () => {
  assert.deepEqual(Object.keys(client).sort(), ["HONEYPOT_FIELD", "TIMESTAMP_FIELD", "honeypotInputProps"]);
  assert.equal(client.HONEYPOT_FIELD, "website");
  assert.equal(client.TIMESTAMP_FIELD, "ts");
  assert.deepEqual(client.honeypotInputProps, { name: "website", tabIndex: -1, autoComplete: "off" });
});

test("the server entry does reach the server code (the walk would see a leak)", () => {
  const files = [...graph(join(dist, "server.js")).keys()].map((file) => relative(dist, file));
  assert.ok(files.includes("helpers.js") && files.includes("steps.js"), files.join(", "));
});
