# @gravixar/forms

Public form submissions for server actions and route handlers. A form is defined once: its schema, bot gate,
identity and delivery. `submit` then runs them in the order live forms do:

1. **The bot gate, on the raw input.** A honeypot and a time trap, and optionally Vercel BotID. It runs before
   validation, so a bot never sees an error naming the field it should have left empty. A bot gets the same "ok"
   as a person, and every ignored submission is logged with its reason.
2. **Validation**, with any [Standard Schema](https://standardschema.dev) validator (zod v4 is one), static or
   built per locale for localized messages. The result has the first error per field path.
3. **An id.** Parts you choose are hashed into a stable id, so a bot replaying one payload makes one record.
4. **Delivery steps**, in order, each returning evidence. **In production, a required step that isn't configured
   fails the submission**, so a missing API key shows the visitor an error instead of losing what they sent.

It was extracted from three live forms: a bilingual enquiry form, a registration form stored for a CRM, and a
booking endpoint behind BotID.

## Two entry points

- `@gravixar/forms`: client-safe. The field names a form renders, and the types. A test walks this entry's module
  graph and fails if it reaches server code, because a client component ships everything it imports.
- `@gravixar/forms/server`: everything that runs a submission.

## Define

```ts
// src/forms/enquiry.ts
import { defineForm, resendMailer } from "@gravixar/forms/server";
import { Resend } from "resend";
import { z } from "zod";

const mailer = resendMailer({ Resend, from: "Website <website@example.com>", fromEnv: "ENQUIRY_FROM" });

export const enquiry = defineForm({
  name: "enquiry", // the record's kind, the dedupe namespace, the log prefix
  schema: ({ locale }) =>
    z.object({
      name: z.string().trim().min(2, msg.name[locale]).max(120),
      email: z.union([z.literal(""), z.email(msg.email[locale])]),
      message: z.string().trim().min(1, msg.message[locale]).max(5000),
    }),
  // Optional. Default: honeypot "website", time trap on "ts" (2 s to 24 h), no BotID.
  gate: { botId: checkBotId },
  // Optional: parts hashed into the id. Omit for a random id.
  dedupe: (data) => [normalizeEmail(data.email), data.name],
  // A function of the step builders, so each step's callbacks see the schema's output.
  deliver: ({ blob, email }) => [
    blob({ store, path: (s) => `enquiries/${s.receivedAt.slice(0, 7)}.jsonl`, required: true }),
    email({
      mailer,
      to: process.env.ENQUIRY_TO,
      subject: (s) => `Enquiry from ${s.data.name}`,
      text: (s) => s.data.message,
      replyTo: (s) => s.data.email || undefined,
      required: false, // stored already, so a failed email is recorded, not fatal
    }),
  ],
});
```

`defineForm` throws a `FormError` when a definition can't work: no required step, two steps with one name, a
schema that validates a gate field, a name that isn't a lower-case id. It throws when the module loads, so the
mistake fails the build.

## Submit

```ts
// src/app/actions.ts
"use server";
import { fromFormData, metaFromHeaders } from "@gravixar/forms/server";
import type { FormState } from "@gravixar/forms";
import { headers } from "next/headers";
import { enquiry } from "@/forms/enquiry";

export async function submitEnquiry(_prev: FormState, fd: FormData): Promise<FormState> {
  const locale = pickLocale(fd);
  const result = await enquiry.submit(fromFormData(fd), { locale, meta: metaFromHeaders(await headers()) });
  if (result.outcome === "failed") return { status: "error", errors: { form: msg.failed[locale] } };
  return result.state;
}
```

`result.outcome` is `delivered`, `ignored` (a bot), `invalid` (with `errors`) or `failed` (a required step
failed). `result.state` is ready for `useActionState`. `fromFormData` turns an absent field into `undefined`,
never `null`, and treats an empty file input as absent. List repeated fields in `{ multiple: ["files"] }`.

## Render

```tsx
import { HONEYPOT_FIELD, TIMESTAMP_FIELD, honeypotInputProps } from "@gravixar/forms";

<div className="hp" aria-hidden="true">
  <label>Website<input {...honeypotInputProps} /></label>
</div>
<input type="hidden" name={TIMESTAMP_FIELD} value={renderedAt} /> {/* Date.now(), set once on mount */}
```

Put the honeypot off-screen with CSS, not `display: none`, which some bots skip. **A form without the timestamp is
ignored**, so add it before switching a live form over.

## Delivery steps

- `email({ mailer, to, subject, text, replyTo?, attachments?, required })`. When `to` is empty, the step isn't
  configured. `toAttachments(files)` turns uploads into attachments.
- `blob({ store, path, toLine?, required })` appends one JSON line per submission, the format a CRM sync reads.
  `store` is a `LineStore`, `{ configured(), appendLine(path, line) }`, over whatever storage the site uses.
  `toLine` returns the record to write; by default it is the whole submission.
- A site's own step implements `DeliveryStep<T>`: `{ name, required, configured(), run(submission) }`, where
  `run` returns `{ ok: true, ref? }` or `{ ok: false, error }`. A throw is caught and recorded the same way.

Every step runs, so one failing doesn't stop another from delivering. Outside production, a step that isn't
configured only logs the submission (a dry run). Production is `VERCEL_ENV=production` on Vercel, whose previews
also set `NODE_ENV=production`, and `NODE_ENV=production` elsewhere.

`resendMailer({ Resend, from, fromEnv?, replyTo?, replyToEnv?, apiKeyEnv? })` takes the SDK's class, so this
package doesn't depend on `resend`. The key is read on each send. The SDK returns API and network failures as
`{ error }` instead of throwing, so the mailer reads `error` on every send.

## Helpers

- `normalizeEmail(email)` collapses Gmail's dots and `+tags` to the one inbox they reach. For dedupe only.
- `stableId(parts)`: SHA-256 of the parts joined by `|`, first 32 hex characters, with Web Crypto.
- `checkGate(input, options?)`: the gate on its own, for a route handler that isn't a form.

## License

[MIT](LICENSE)
