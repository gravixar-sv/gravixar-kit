import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";
import { blobStep, defineForm, emailStep, FormError, normalizeEmail, stableId } from "../dist/server.js";

// ---- fixtures -------------------------------------------------------------------------------------------------

const msg = {
  name: { en: "Please enter your name.", ar: "يُرجى إدخال الاسم." },
  email: { en: "Please enter a valid email address.", ar: "يُرجى إدخال بريد إلكتروني صحيح." },
  message: { en: "Please write a message.", ar: "يُرجى كتابة رسالة." },
};

/** Built per request for localized messages, as a live bilingual form does. */
const enquirySchema = ({ locale }) =>
  z.object({
    name: z.string().trim().min(2, msg.name[locale]).max(120),
    email: z.union([z.literal(""), z.email(msg.email[locale])]),
    message: z.string().trim().min(1, msg.message[locale]).max(5000),
  });

const person = () => ({ name: "Jane Doe", email: "jane@example.com", message: "Hello", website: "", ts: Date.now() - 10_000 });

/** A line store in memory. */
function memoryStore({ configured = true, fail } = {}) {
  const lines = [];
  return {
    lines,
    needs: "BLOB_STORE_ID",
    configured: () => configured,
    async appendLine(path, line) {
      if (fail) throw new Error(fail);
      lines.push({ path, line });
    },
  };
}

/** A mailer that records what it would send. */
function memoryMailer({ configured = true, error } = {}) {
  const sent = [];
  return {
    sent,
    needs: "RESEND_API_KEY",
    configured: () => configured,
    async send(message) {
      if (error) return { ok: false, error };
      sent.push(message);
      return { ok: true, ref: `email-${sent.length}` };
    },
  };
}

function enquiry({ store = memoryStore(), mailer = memoryMailer(), emailRequired = false, ...rest } = {}) {
  const form = defineForm({
    name: "enquiry",
    schema: enquirySchema,
    deliver: ({ blob, email }) => [
      blob({ store, path: (s) => `enquiries/${s.receivedAt.slice(0, 7)}.jsonl`, required: true }),
      email({
        mailer,
        to: "office@example.com",
        subject: (s) => `Enquiry from ${s.data.name}`,
        text: (s) => s.data.message,
        replyTo: (s) => s.data.email || undefined,
        required: emailRequired,
      }),
    ],
    ...rest,
  });
  return { form, store, mailer };
}

// ---- environment and logs ---------------------------------------------------------------------------------------

const ENV = ["VERCEL_ENV", "NODE_ENV"];
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
let logs;

beforeEach((t) => {
  for (const name of ENV) delete process.env[name];
  logs = { info: [], warn: [], error: [] };
  for (const level of Object.keys(logs)) t.mock.method(console, level, (...args) => logs[level].push(args.join(" ")));
});
afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

// ---- the definition fails the build when it can't work --------------------------------------------------------------

/** Runs fn and returns the FormError it throws. */
function thrown(fn) {
  try {
    fn();
  } catch (error) {
    assert.ok(error instanceof FormError, `expected a FormError, got ${error}`);
    return error;
  }
  assert.fail("expected a FormError");
}

test("a form with no required step is refused", () => {
  const error = thrown(() => enquiry({ deliver: [blobStep({ store: memoryStore(), path: () => "x", required: false })] }));
  assert.match(error.message, /at least one required delivery step/);
});

test("two steps with one name are refused", () => {
  const step = () => blobStep({ store: memoryStore(), path: () => "x", required: true });
  assert.match(thrown(() => enquiry({ deliver: [step(), step()] })).message, /two delivery steps named "blob"/);
});

test("a name that isn't a lower-case id is refused", () => {
  assert.match(thrown(() => enquiry({ name: "Enquiry Form" })).message, /lower-case id/);
});

test("a schema that validates a gate field is refused at definition", () => {
  const schema = z.object({ name: z.string(), website: z.string() });
  assert.match(thrown(() => enquiry({ schema })).message, /validates "website"/);
  const legacy = z.object({ name: z.string(), hp_website: z.string().optional() });
  assert.match(thrown(() => enquiry({ schema: legacy })).message, /validates "hp_website"/);
  const ts = z.object({ ts: z.number() });
  assert.match(thrown(() => enquiry({ schema: ts })).message, /validates "ts"/);
});

test("a per-locale schema that validates a gate field is refused at its first submission", async () => {
  const { form } = enquiry({ schema: () => z.object({ website: z.string() }) });
  await assert.rejects(form.submit(person(), { locale: "en" }), FormError);
});

test("one field for the honeypot and the timestamp is refused, and so is an impossible time trap", () => {
  assert.match(thrown(() => enquiry({ gate: { honeypot: "ts" } })).message, /both the honeypot and the timestamp/);
  assert.match(thrown(() => enquiry({ gate: { timeTrap: { field: "hp_website" } } })).message, /both the honeypot/);
  assert.match(thrown(() => enquiry({ gate: { timeTrap: { minMs: 5_000, maxAgeMs: 1_000 } } })).message, /minMs < maxAgeMs/);
});

// ---- the order: gate, validation, id, delivery ----------------------------------------------------------------------

test("a person's enquiry is validated, stored and emailed", async () => {
  const { form, store, mailer } = enquiry();
  const result = await form.submit(person(), { locale: "en", meta: { ip: "203.0.113.7" } });

  assert.equal(result.outcome, "delivered");
  assert.deepEqual(result.state, { status: "ok" });
  assert.match(result.id, /^[0-9a-f]{32}$/);
  assert.deepEqual(result.evidence.map((e) => [e.step, e.ok, e.ref]), [
    ["blob", true, store.lines[0].path],
    ["email", true, "email-1"],
  ]);

  const line = JSON.parse(store.lines[0].line);
  assert.equal(line.id, result.id);
  assert.equal(line.form, "enquiry");
  assert.deepEqual(line.data, { name: "Jane Doe", email: "jane@example.com", message: "Hello" });
  assert.deepEqual(line.meta, { ip: "203.0.113.7" });
  assert.equal(line.locale, "en");
  assert.match(store.lines[0].path, /^enquiries\/\d{4}-\d{2}\.jsonl$/);

  assert.deepEqual(mailer.sent, [
    { to: ["office@example.com"], subject: "Enquiry from Jane Doe", text: "Hello", replyTo: "jane@example.com" },
  ]);
});

test("the gate fields never reach the validator or the stored record", async () => {
  // A strict schema would reject unknown keys, so the gate removes its fields first.
  const schema = z.strictObject({ name: z.string() });
  const store = memoryStore();
  const form = defineForm({
    name: "strict",
    schema,
    deliver: [blobStep({ store, path: () => "x.jsonl", required: true })],
  });
  const result = await form.submit({ name: "Jane", website: "", hp_website: "", ts: Date.now() - 5_000 }, { locale: "en" });
  assert.equal(result.outcome, "delivered");
  assert.deepEqual(JSON.parse(store.lines[0].line).data, { name: "Jane" });
});

test("a bot gets the same ok as a person, nothing is delivered, and the reason is logged", async () => {
  const { form, store, mailer } = enquiry();
  const result = await form.submit({ ...person(), website: "https://spam.example" }, { locale: "en" });
  assert.deepEqual(result, { outcome: "ignored", reason: "honeypot_filled", state: { status: "ok" } });
  assert.equal(store.lines.length, 0);
  assert.equal(mailer.sent.length, 0);
  assert.match(logs.warn[0], /\[forms:enquiry\] ignored a submission: honeypot_filled/);
});

test("the gate runs before validation, so a bot never sees which field it failed", async () => {
  const { form } = enquiry();
  const result = await form.submit({ website: "x", name: "", message: "" }, { locale: "en" });
  assert.equal(result.outcome, "ignored");
});

test("a form without a timestamp is ignored", async () => {
  const { form } = enquiry();
  const { ts, ...noTs } = person();
  assert.equal((await form.submit(noTs, { locale: "en" })).reason, "ts_missing");
});

test("invalid input returns the first error per field, in the locale's messages", async () => {
  const { form, store } = enquiry();
  const input = { ...person(), name: "J", email: "not-an-address", message: "" };

  const en = await form.submit(input, { locale: "en" });
  assert.equal(en.outcome, "invalid");
  assert.deepEqual(en.errors, { name: msg.name.en, email: msg.email.en, message: msg.message.en });
  assert.deepEqual(en.state, { status: "error", errors: en.errors });

  const ar = await form.submit(input, { locale: "ar" });
  assert.deepEqual(ar.errors, { name: msg.name.ar, email: msg.email.ar, message: msg.message.ar });
  assert.equal(store.lines.length, 0);
});

test("nested paths are joined with dots, and a pathless issue is keyed form", async () => {
  const schema = z
    .object({ contact: z.object({ phone: z.string().min(7, "phone") }), via: z.enum(["phone", "email"]), email: z.string() })
    .refine((d) => d.via !== "email" || d.email !== "", { message: "email needed" })
    .refine((d) => d.via !== "email" || d.email !== "", { message: "second", path: [] });
  const form = defineForm({ name: "nested", schema, deliver: [blobStep({ store: memoryStore(), path: () => "x", required: true })] });
  const result = await form.submit({ contact: { phone: "1" }, via: "email", email: "", ts: Date.now() - 5_000 }, { locale: "en" });
  assert.deepEqual(result.errors, { "contact.phone": "phone", form: "email needed" });
  const refined = await form.submit({ contact: { phone: "1234567" }, via: "email", email: "", ts: Date.now() - 5_000 }, { locale: "en" });
  assert.deepEqual(refined.errors, { form: "email needed" });
});

test("dedupe parts become a stable id, namespaced by the form", async () => {
  const store = memoryStore();
  const form = defineForm({
    name: "registration",
    schema: z.object({ email: z.string(), child: z.string() }),
    dedupe: (d) => [normalizeEmail(d.email), d.child.trim().toLowerCase(), "2026-09"],
    deliver: [blobStep({ store, path: () => "x.jsonl", required: true })],
  });
  const submit = (email, child) => form.submit({ email, child, ts: Date.now() - 5_000 }, { locale: "en" });

  const first = await submit("jane.doe@gmail.com", "Sam");
  const replay = await submit("janedoe+x@gmail.com", " sam ");
  const sibling = await submit("jane.doe@gmail.com", "Alex");
  assert.equal(first.id, replay.id);
  assert.notEqual(first.id, sibling.id);
  assert.equal(first.id, await stableId(["registration", "janedoe@gmail.com", "sam", "2026-09"]));
});

test("without dedupe, every submission gets a new random id", async () => {
  const { form } = enquiry();
  const a = await form.submit(person(), { locale: "en" });
  const b = await form.submit(person(), { locale: "en" });
  assert.notEqual(a.id, b.id);
  assert.match(b.id, /^[0-9a-f]{32}$/);
});

// ---- delivery -------------------------------------------------------------------------------------------------------

test("a failed optional step is recorded, and the submission is still delivered", async () => {
  const { form, store } = enquiry({ mailer: memoryMailer({ error: "validation_error: bad from" }) });
  const result = await form.submit(person(), { locale: "en" });
  assert.equal(result.outcome, "delivered");
  assert.equal(store.lines.length, 1);
  assert.deepEqual(result.evidence.map((e) => [e.step, e.ok, e.error]), [
    ["blob", true, undefined],
    ["email", false, "validation_error: bad from"],
  ]);
  assert.match(logs.error[0], /"email" failed for submission [0-9a-f]{32}: validation_error: bad from/);
});

test("a required step that throws fails the submission, and later steps still run", async () => {
  const { form, mailer } = enquiry({ store: memoryStore({ fail: "store refused the write" }) });
  const result = await form.submit(person(), { locale: "en" });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.state, { status: "error" });
  assert.equal(result.evidence[0].error, "store refused the write");
  assert.equal(mailer.sent.length, 1, "the email still reaches the office");
});

test("a required email that fails fails the submission", async () => {
  const { form } = enquiry({ mailer: memoryMailer({ error: "rate_limited" }), emailRequired: true });
  assert.equal((await form.submit(person(), { locale: "en" })).outcome, "failed");
});

test("outside production, a step that isn't configured is a logged dry run", async () => {
  const { form, store } = enquiry({ store: memoryStore({ configured: false }), mailer: memoryMailer({ configured: false }) });
  const result = await form.submit(person(), { locale: "en" });
  assert.equal(result.outcome, "delivered");
  assert.deepEqual(result.evidence.map((e) => [e.step, e.ok, e.dryRun]), [
    ["blob", true, true],
    ["email", true, true],
  ]);
  assert.equal(store.lines.length, 0);
  assert.match(logs.info[0], /dry run: "blob" is not configured \(needs BLOB_STORE_ID\)/);
  assert.match(logs.info[1], /dry run: "email" is not configured \(needs RESEND_API_KEY\)/);
});

test("in production, a required step that isn't configured fails the submission instead of losing it", async () => {
  process.env.VERCEL_ENV = "production";
  const { form } = enquiry({ store: memoryStore({ configured: false }) });
  const result = await form.submit(person(), { locale: "en" });
  assert.equal(result.outcome, "failed");
  assert.deepEqual(result.evidence[0], { step: "blob", ok: false, error: "not configured (needs BLOB_STORE_ID)", at: result.evidence[0].at });
  assert.match(logs.error[0], /"blob" is not configured \(needs BLOB_STORE_ID\)/);
});

test("in production, an optional step that isn't configured is recorded but not fatal", async () => {
  process.env.VERCEL_ENV = "production";
  const { form } = enquiry({ mailer: memoryMailer({ configured: false }) });
  const result = await form.submit(person(), { locale: "en" });
  assert.equal(result.outcome, "delivered");
  assert.equal(result.evidence[1].ok, false);
  assert.equal(result.evidence[1].dryRun, undefined);
});

test("a Vercel preview is not production, even with NODE_ENV=production", async () => {
  process.env.VERCEL_ENV = "preview";
  process.env.NODE_ENV = "production";
  const { form } = enquiry({ store: memoryStore({ configured: false }) });
  assert.equal((await form.submit(person(), { locale: "en" })).outcome, "delivered");
});

test("off Vercel, NODE_ENV=production is production", async () => {
  process.env.NODE_ENV = "production";
  const { form } = enquiry({ store: memoryStore({ configured: false }) });
  assert.equal((await form.submit(person(), { locale: "en" })).outcome, "failed");
});

test("an email step without a recipient isn't configured", async () => {
  process.env.VERCEL_ENV = "production";
  const step = emailStep({ mailer: memoryMailer(), to: undefined, subject: () => "", text: () => "", required: true });
  assert.equal(step.configured(), false);
  assert.equal(step.needs, "a recipient");
  const unkeyed = emailStep({ mailer: memoryMailer({ configured: false }), to: " ", subject: () => "", text: () => "", required: true });
  assert.equal(unkeyed.needs, "RESEND_API_KEY and a recipient");
});

test("blobStep writes the record toLine returns, as one JSON line", async () => {
  const store = memoryStore();
  const form = defineForm({
    name: "lead",
    schema: z.object({ name: z.string() }),
    deliver: [
      blobStep({
        store,
        path: (s) => `leads/${s.id}.jsonl`,
        toLine: (s) => ({ kind: "LEAD", id: s.id, name: s.data.name, note: "line one\nline two" }),
        required: true,
      }),
    ],
  });
  const result = await form.submit({ name: "Jane", ts: Date.now() - 5_000 }, { locale: "en" });
  const [{ path, line }] = store.lines;
  assert.equal(path, `leads/${result.id}.jsonl`);
  assert.equal(line.includes("\n"), false);
  assert.deepEqual(JSON.parse(line), { kind: "LEAD", id: result.id, name: "Jane", note: "line one\nline two" });
});

// ---- BotID ----------------------------------------------------------------------------------------------------------

test("BotID blocks an unverified bot, and lets a verified one through", async () => {
  const bot = enquiry({ gate: { botId: async () => ({ isBot: true, isVerifiedBot: false }) } });
  assert.deepEqual(await bot.form.submit(person(), { locale: "en" }), { outcome: "ignored", reason: "botid", state: { status: "ok" } });
  assert.equal(bot.mailer.sent.length, 0);

  const verified = enquiry({ gate: { botId: async () => ({ isBot: true, isVerifiedBot: true }) } });
  assert.equal((await verified.form.submit(person(), { locale: "en" })).outcome, "delivered");
});

test("BotID runs after the static gate, and fails open when it errors", async () => {
  let calls = 0;
  const { form } = enquiry({
    gate: {
      botId: async () => {
        calls++;
        throw new Error("network down");
      },
    },
  });
  await form.submit({ ...person(), website: "x" }, { locale: "en" });
  assert.equal(calls, 0, "a tripped honeypot never costs a BotID check");
  assert.equal((await form.submit(person(), { locale: "en" })).outcome, "delivered");
  assert.match(logs.error[0], /BotID check failed, so it was skipped: network down/);
});
