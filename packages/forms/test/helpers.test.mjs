import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { fromFormData, metaFromHeaders, normalizeEmail, stableId } from "../dist/server.js";

test("normalizeEmail collapses Gmail's dots and +tags to one inbox", () => {
  assert.equal(normalizeEmail("j.a.n.e.d.o.e@gmail.com"), "janedoe@gmail.com");
  assert.equal(normalizeEmail("Jane.Doe+news@GoogleMail.com"), "janedoe@gmail.com");
  assert.equal(normalizeEmail("  JANE@EXAMPLE.COM "), "jane@example.com");
});

test("normalizeEmail leaves other domains' dots alone, and tolerates junk", () => {
  assert.equal(normalizeEmail("first.last+x@example.com"), "first.last+x@example.com");
  assert.equal(normalizeEmail("not-an-address"), "not-an-address");
  assert.equal(normalizeEmail("@gmail.com"), "@gmail.com");
});

test("stableId is the first 32 hex characters of SHA-256 over the parts joined by |", async () => {
  // The hash the live registration form computed with node:crypto, now with Web Crypto: an extraction, not a change.
  const parts = ["registration", "janedoe@gmail.com", "sam", "2026-09"];
  const expected = createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
  assert.equal(await stableId(parts), expected);
  assert.match(await stableId(parts), /^[0-9a-f]{32}$/);
});

test("stableId is stable for one payload and differs across parts", async () => {
  assert.equal(await stableId(["a", "b"]), await stableId(["a", "b"]));
  assert.notEqual(await stableId(["a", "b"]), await stableId(["a", "c"]));
  assert.notEqual(await stableId(["a", "2026-09"]), await stableId(["a", "2026-10"]));
});

test("fromFormData: an absent field is undefined, never null", () => {
  const fd = new FormData();
  fd.set("name", "Jane");
  const out = fromFormData(fd);
  assert.deepEqual(out, { name: "Jane" });
  assert.equal(out.website, undefined);
  assert.equal(out.ts, undefined);
});

test("fromFormData keeps text as typed, and the first of repeated values", () => {
  const fd = new FormData();
  fd.append("name", "  Jane  ");
  fd.append("tag", "a");
  fd.append("tag", "b");
  assert.deepEqual(fromFormData(fd), { name: "  Jane  ", tag: "a" });
});

test("fromFormData: files pass through, and an empty file input counts as absent", () => {
  const fd = new FormData();
  const cv = new File(["%PDF"], "cv.pdf", { type: "application/pdf" });
  fd.set("cv", cv);
  fd.set("photo", new File([], ""));
  const out = fromFormData(fd);
  assert.ok(out.cv instanceof File);
  assert.equal(out.cv.name, "cv.pdf");
  assert.equal("photo" in out, false);
});

test("fromFormData: a field listed in multiple is always an array", () => {
  const fd = new FormData();
  fd.append("files", new File(["a"], "a.pdf"));
  fd.append("files", new File([], ""));
  fd.append("files", new File(["b"], "b.pdf"));
  const out = fromFormData(fd, { multiple: ["files", "topics"] });
  assert.deepEqual(out.files.map((f) => f.name), ["a.pdf", "b.pdf"]);
  assert.deepEqual(out.topics, []);
});

test("metaFromHeaders takes the first forwarded address and the user agent", () => {
  const headers = new Headers({ "x-forwarded-for": " 203.0.113.7 , 10.0.0.1", "user-agent": "Test/1.0" });
  assert.deepEqual(metaFromHeaders(headers), { ip: "203.0.113.7", userAgent: "Test/1.0" });
  assert.deepEqual(metaFromHeaders(new Headers({ "x-real-ip": "198.51.100.2" })), { ip: "198.51.100.2" });
  assert.deepEqual(metaFromHeaders(new Headers()), {});
});
