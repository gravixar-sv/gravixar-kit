# `@gravixar/forms`: API draft

**Status: built as `@gravixar/forms` 0.2.0** ([packages/forms](../packages/forms)); where the build differs from
this draft is listed at the end. Everything here is extracted from forms already running on live sites: a
bilingual enquiry form (email only), a registration form (stored for a CRM, deduplicated) and a booking
endpoint (the bot gate plus BotID). Nothing is invented except where marked **new**, and each of those closes a
failure one of those sites has shown.

## What every live form does today

| Step | Live today | Draft |
|---|---|---|
| Bot gate | A honeypot field, checked on the raw input **before** validation; a tripped one gets a silent success, logged. One endpoint adds a time trap and BotID. | Same order. The time trap is on by default, and a missing timestamp fails it (**new**: today, omitting the field skips the trap). |
| Validation | zod v4. Errors keyed by field path, first error per field. One site builds the schema per request for localized messages. | Any [Standard Schema](https://standardschema.dev) validator (zod v4 is one), static or built per locale. |
| Identity | One form hashes the normalized email and a subject into a stable id, so a bot looping N times makes one record, not N. | `dedupe` parts hashed with Web Crypto (**new**: today `node:crypto`, which once leaked into a client chunk on a green build). |
| Delivery | Email through Resend; or JSONL appended to Blob storage for a CRM cron. | Delivery steps, each returning evidence. The result says which steps delivered. |
| Failure | Visible, localized error with a fallback contact when delivery fails. **But** a missing API key returns success and loses the submission, and a Resend error is missed by `try/catch`. | Fail closed in production when a required step isn't configured (**new**); Resend's `error` field is always checked (**new**). |
| Rate limit | None anywhere. | A hook only; see open questions. |

## Shape

Two entry points, because a client component that imports server code ships it to the browser:

- `@gravixar/forms`: client-safe. Field names and the types a form component needs.
- `@gravixar/forms/server`: everything that runs the submission.

```ts
// src/forms/enquiry.ts (server)
import { defineForm, emailStep, blobStep } from "@gravixar/forms/server";
import { z } from "zod";

export const enquiry = defineForm({
  name: "enquiry",                         // the record's kind, the dedupe namespace, the log prefix
  schema: ({ locale }) =>                   // or a plain schema
    z.object({
      name: z.string().min(2, msg.name[locale]).max(120),
      email: z.email(msg.email[locale]).or(z.literal("")),
      message: z.string().min(1, msg.message[locale]).max(5000),
    }),
  gate: {
    honeypot: "website",                    // default; the field every live form already renders
    timeTrap: { field: "ts", minMs: 2_000, maxAgeMs: 86_400_000 },   // default; a missing ts fails
    botId: undefined,                       // optional: () => Promise<{ isBot?: boolean; isVerifiedBot?: boolean }>
  },
  dedupe: (data) => [normalizeEmail(data.email), data.name, monthOf(new Date())],   // optional
  deliver: [
    blobStep({ store, path: (d) => `enquiries/${d.receivedAt.slice(0, 7)}.jsonl`, required: true }),
    emailStep({
      mailer,                               // { send(message) } over the Resend SDK, see below
      to: process.env.ENQUIRY_TO!,
      subject: (d) => `Enquiry from ${d.data.name}`,
      text: renderEnquiry,
      replyTo: (d) => d.data.email || undefined,
      required: false,                      // stored already, so a failed email is recorded, not fatal
    }),
  ],
});
```

```ts
// src/app/actions.ts ("use server": export only async functions)
import { fromFormData } from "@gravixar/forms/server";
import { enquiry } from "@/forms/enquiry";

export async function submitEnquiry(_prev: FormState, fd: FormData): Promise<FormState> {
  const result = await enquiry.submit(fromFormData(fd), { locale: pickLocale(fd), meta: await requestMeta() });
  return result.state;                      // client-safe; a bot and a person get the same "ok"
}
```

## API

### `defineForm(definition)`

```ts
interface FormDefinition<T> {
  name: string;                                        // lower-case id: "enquiry", "registration"
  schema: StandardSchema<T> | ((ctx: { locale: string }) => StandardSchema<T>);
  gate?: {
    honeypot?: string | false;                         // default "website"
    timeTrap?: { field?: string; elapsedField?: string; minMs?: number; maxAgeMs?: number } | false;
                                                       // default { "ts", "te", 2000, 24 h }
    botId?: () => Promise<BotIdVerdict>;               // block unverified bots (for forms that email an address the caller supplies)
  };
  dedupe?: (data: T) => readonly string[];             // hashed to a 32-hex-char id; omit for a random id
  deliver: readonly DeliveryStep<T>[];                 // at least one required step
}
```

`defineForm` throws when the definition can't work: no required delivery step, or a gate field that clashes
with a schema field. It fails at module load, and so fails the build, like `@gravixar/theme`.

### `form.submit(input, context)`

```ts
submit(input: Record<string, unknown>, context: { locale: string; meta?: SubmissionMeta }): Promise<SubmitResult<T>>;

type SubmitResult<T> =
  | { outcome: "delivered"; id: string; evidence: Evidence[]; state: FormState }   // every required step delivered
  | { outcome: "ignored"; reason: GateReason; state: FormState }                   // bot: state is the same "ok"
  | { outcome: "invalid"; errors: Record<string, string>; state: FormState }       // first error per field path
  | { outcome: "failed"; id: string; evidence: Evidence[]; state: FormState };     // a required step failed

type FormState = { status: "idle" | "ok" | "error"; errors?: Record<string, string> };
type GateReason = "honeypot_filled" | "ts_missing" | "ts_invalid" | "ts_too_fast" | "ts_stale" | "botid";
type Evidence = { step: string; ok: boolean; ref?: string; error?: string; at: string };
```

Order, as live today: gate on the raw input, then validation, then `dedupe`, then the delivery steps in
order. The gate runs first so a bot never sees validation errors: a validator that rejects a filled honeypot
field returns a 422 naming the field, which tells the bot exactly what to leave empty. Every `ignored` is logged
with its reason, because browsers autofill hidden fields and a real person can trip the honeypot.

### `fromFormData(fd, options?)`

Turns `FormData` into a plain object. An absent field is `undefined`, never `null`: today a `null` from
`fd.get()` reads as a malformed honeypot, and a `null` timestamp as a form 56 years old. Files come through as
`File`, and a field listed in `options.multiple` comes through as an array.

### Delivery steps

```ts
interface DeliveryStep<T> {
  name: string;
  required: boolean;
  configured(): boolean;                     // false: missing key or token
  run(submission: Submission<T>): Promise<Evidence>;
}
type Submission<T> = { id: string; form: string; data: T; locale: string; meta: SubmissionMeta; receivedAt: string };
```

- `emailStep({ mailer, to, subject, text, replyTo?, attachments?, required })`. It reads Resend's `{ data, error }`
  and records `error`: the SDK returns API and network failures instead of throwing, so `try/catch` sees none of them.
- `blobStep({ store, path, toLine?, required })` appends one JSON line: the CRM-pipe format a live form already uses.
- A site can add its own step: a CRM webhook, or, in Phase 2, a Payload collection with the submission inbox.

**When a step isn't configured** (**new**): outside production it is skipped with a logged dry run, as today.
In production, a required step that isn't configured makes the submission `failed`: the visitor sees the
localized error and the fallback contact, and the log says which variable is missing. Today one site returns
success without an API key, so every enquiry is lost with nothing showing.

### Client entry (`@gravixar/forms`)

```ts
export const HONEYPOT_FIELD = "website";
export const TIMESTAMP_FIELD = "ts";
export const ELAPSED_FIELD = "te";
export function createFormClock(): FormClock;   // { fields(): { ts, te }; stamp(form or FormData); reset() }
export type { FormState, SubmitResult };
```

The form renders the honeypot off-screen, as the live forms do, rather than with `display: none`, which some
bots skip. The build adds `tabIndex={-1}` and `autoComplete="off"` so keyboard users and autofill stay out of it.
`createFormClock()` times the form from when the page began to load, and stamps `ts` and `te` into the form when it
is submitted (see the last section). Nothing in this entry may import a Node builtin. The package's tests include the check a
live site already runs: build a page that renders a form, and fail if any client chunk contains server code.

### Helpers, extracted as they are

- `normalizeEmail(email)`: collapses Gmail dots and `+tags` to the one inbox they reach. Used for dedupe only,
  never to reject, and never as the stored address.
- `stableId(parts)`: SHA-256 of the parts joined by `|`, first 32 hex characters (Web Crypto).

## Where the shared parts come from

The gate and the Resend mailer exist today in Gravixar's private backend package. They move here, because the
kit never depends on a private package, and the private package re-exports them so its current consumer keeps
working. Its honeypot field name, `hp_website`, stays accepted as an alias.

## Open questions

1. **Rate limiting.** No live form has it, so it isn't in v0 by the extraction rule. The hook is
   `gate.limit?: (key: string) => Promise<boolean>`, keyed by IP and form. The first site that needs a store (the
   forms that email a caller-supplied address are the candidates) generalises it.
2. **A signed timestamp.** `ts` and `te` are set by the client and unsigned, so a bot can forge them. A
   server-issued HMAC token would fix that. Not live anywhere yet. A fast client clock no longer trips the trap
   when the form sends `te` (see the last section).
3. **Retention.** The inbox (Phase 2) needs a retention period per form for UAE PDPL. It belongs to the storage
   step, not the gate.

## Where the build differs from this draft

- **`deliver` is a function of the step builders**, `({ email, blob }) => [...]`. TypeScript checks a generic call
  such as `emailStep({...})` inside a plain array before it knows the schema's output, so the step's callbacks
  would see `unknown`. The builders are bound to the output. A plain array still works for steps that are already
  typed.
- **A step's `run` returns `{ ok: true, ref? } | { ok: false, error }`**, and the form adds the step's name and time
  to make the evidence. A step may also say what it `needs` (`"RESEND_API_KEY"`), which is what the log names.
- **`resendMailer({ Resend, ... })` takes the SDK's class**, so the package has no dependency on `resend`. It sends
  attachment bytes as base64: the SDK puts `content` into a JSON body as it is.
- **`blobStep` takes a `LineStore`**, `{ configured(), appendLine(path, line) }`, rather than a storage client, and
  `toLine` returns the record to write.
- **Evidence has `dryRun: true`** for a step that wasn't configured outside production.
- **Production** is `VERCEL_ENV=production` on Vercel (its previews set `NODE_ENV=production` too), and
  `NODE_ENV=production` elsewhere.
- **`fromFormData` treats an empty file input as absent**: browsers send a zero-byte `File` when nothing is chosen.
- **`hp_website` is checked whenever the honeypot is on**, and removed before validation like the other gate fields.
- **BotID fails open**: if the check throws, the error is logged and the submission goes on, because the static gate
  has already passed and dropping a person silently is the worse failure.
- **Added:** `metaFromHeaders`, `toAttachments`, `checkGate` on its own, and `honeypotInputProps` in the client entry.
- **The time trap reads an elapsed time (0.2.0).** `ts` is the device's clock, compared with the server's, so a
  phone whose clock ran minutes fast made a person look too fast, and a tab left open for more than a day looked
  stale. The gate ignored both while the visitor saw "sent". `te` (`ELAPSED_FIELD`) is how long the form was
  open, measured in the browser with `performance.now()`, so a wrong clock cancels out. When a form sends `te`,
  the gate checks only that `te >= minMs`: no age limit, and `ts` isn't needed. A `te` that isn't a finite,
  non-negative number is ignored, exactly as if it were absent: rejecting it would drop a person whose hand-rolled
  timer went negative after a clock correction, and a bot gains nothing because it could leave `te` out. **Without
  a usable `te`, `ts` is checked exactly as in 0.1.0**, so a form that sends only `ts` behaves as before.
  `createFormClock()` in the client entry sends both. The trap is a cheap filter for naive bots, not a security
  boundary, so it must never drop a person.
- **The clock starts at page load (0.2.1).** In 0.2.0 `createFormClock()` started timing when it was created, which
  is when the form hydrates. A server-rendered form can be filled before that, and on a live contact form inside a
  `<Suspense>` boundary, hydration came 19 s after load. A person who sent the form just after it hydrated was
  ignored as too fast while the page said "sent". The first submission is now timed from `performance.now()`'s
  origin, the start of the navigation. `reset()` still times the next one from when it is called. The gate is
  unchanged.