import { afterEach, beforeEach, test } from "node:test";
import assert from "node:assert/strict";
import { resendMailer, toAttachments } from "../dist/server.js";

/** Stands in for the Resend SDK class, answering the way resend v6 does: `{ data, error }`, never a throw. */
function fakeResend(reply = () => ({ data: { id: "email-1" }, error: null })) {
  const built = [];
  const sent = [];
  class Resend {
    constructor(key) {
      built.push(key);
      this.emails = {
        send: async (payload) => {
          sent.push(payload);
          return reply(payload);
        },
      };
    }
  }
  return { Resend, built, sent };
}

const ENV = ["RESEND_API_KEY", "MAIL_KEY", "ENQUIRY_FROM"];
const saved = Object.fromEntries(ENV.map((name) => [name, process.env[name]]));
beforeEach(() => {
  for (const name of ENV) delete process.env[name];
});
afterEach(() => {
  for (const name of ENV) {
    if (saved[name] === undefined) delete process.env[name];
    else process.env[name] = saved[name];
  }
});

const message = { to: ["office@example.com"], subject: "Enquiry", text: "Hello" };

test("without a key the mailer isn't configured, and names the variable it needs", async () => {
  const { Resend, built } = fakeResend();
  const mailer = resendMailer({ Resend, from: "Site <site@example.com>" });
  assert.equal(mailer.configured(), false);
  assert.equal(mailer.needs, "RESEND_API_KEY");
  assert.equal(mailer.client(), null);
  assert.deepEqual(await mailer.send(message), { ok: false, error: "RESEND_API_KEY is not set" });
  assert.equal(built.length, 0);
});

test("a send returns Resend's id", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const { Resend, sent } = fakeResend();
  const mailer = resendMailer({ Resend, from: "Site <site@example.com>", replyTo: "office@example.com" });
  assert.deepEqual(await mailer.send(message), { ok: true, ref: "email-1" });
  assert.deepEqual(sent, [
    { from: "Site <site@example.com>", to: ["office@example.com"], subject: "Enquiry", text: "Hello", replyTo: "office@example.com" },
  ]);
});

test("an error Resend returns instead of throwing is a failure, not a success", async () => {
  // resend v6 reports API and network failures in `error`; a try/catch alone reads this as sent.
  process.env.RESEND_API_KEY = "re_test";
  const { Resend } = fakeResend(() => ({ data: null, error: { name: "validation_error", message: "Invalid `from` field." } }));
  const mailer = resendMailer({ Resend, from: "bad" });
  assert.deepEqual(await mailer.send(message), { ok: false, error: "validation_error: Invalid `from` field." });
});

test("a throw is caught, and a reply with neither id nor error is a failure", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const throwing = fakeResend(() => {
    throw new Error("socket hang up");
  });
  assert.deepEqual(await resendMailer({ Resend: throwing.Resend, from: "x" }).send(message), { ok: false, error: "socket hang up" });
  const empty = fakeResend(() => ({ data: null, error: null }));
  assert.deepEqual(await resendMailer({ Resend: empty.Resend, from: "x" }).send(message), {
    ok: false,
    error: "Resend returned neither an id nor an error",
  });
});

test("the key is read on each send, and the client is rebuilt only when it changes", async () => {
  const { Resend, built } = fakeResend();
  const mailer = resendMailer({ Resend, apiKeyEnv: "MAIL_KEY", from: "x" });
  assert.equal(mailer.configured(), false);
  process.env.MAIL_KEY = "re_one";
  assert.equal(mailer.configured(), true);
  await mailer.send(message);
  await mailer.send(message);
  process.env.MAIL_KEY = "re_two";
  await mailer.send(message);
  assert.deepEqual(built, ["re_one", "re_two"]);
});

test("an environment variable overrides the sender, and an empty one doesn't", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const { Resend, sent } = fakeResend();
  const mailer = resendMailer({ Resend, from: "Site <site@example.com>", fromEnv: "ENQUIRY_FROM" });
  process.env.ENQUIRY_FROM = "";
  assert.equal(mailer.from, "Site <site@example.com>");
  process.env.ENQUIRY_FROM = "Office <office@example.com>";
  await mailer.send({ ...message, replyTo: "jane@example.com" });
  assert.equal(sent[0].from, "Office <office@example.com>");
  assert.equal(sent[0].replyTo, "jane@example.com");
});

test("attachment bytes are sent as base64, which survives the SDK's JSON body", async () => {
  process.env.RESEND_API_KEY = "re_test";
  const { Resend, sent } = fakeResend();
  const bytes = new Uint8Array(70_000).map((_, i) => i % 256);
  await resendMailer({ Resend, from: "x" }).send({
    ...message,
    attachments: [
      { filename: "a.bin", content: bytes },
      { filename: "b.txt", content: "aGVsbG8=" },
    ],
  });
  const [a, b] = sent[0].attachments;
  assert.equal(a.content, Buffer.from(bytes).toString("base64"));
  assert.deepEqual(b, { filename: "b.txt", content: "aGVsbG8=" });
  assert.deepEqual(JSON.parse(JSON.stringify(sent[0])).attachments[0].content, a.content);
});

test("toAttachments reads uploaded files and makes their names safe", async () => {
  const [attachment] = await toAttachments([new File(["%PDF-1.7"], "../my cv (final)!.pdf", { type: "application/pdf" })]);
  assert.equal(attachment.filename, ".._my cv _final_.pdf");
  assert.equal(new TextDecoder().decode(attachment.content), "%PDF-1.7");
  const [long] = await toAttachments([new File(["x"], `${"a".repeat(200)}.pdf`)]);
  assert.equal(long.filename.length, 120);
});
