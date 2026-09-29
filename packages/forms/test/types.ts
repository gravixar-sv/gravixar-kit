// Checked by `pnpm typecheck` against the built declarations, as a consumer sees them. Each @ts-expect-error is a
// negative test: if the types stop rejecting that line, the directive goes unused and the typecheck fails.
import { Resend } from "resend";
import { z } from "zod";
import {
  createFormClock,
  ELAPSED_FIELD,
  HONEYPOT_FIELD,
  honeypotInputProps,
  TIMESTAMP_FIELD,
  type FormClock,
  type FormState,
} from "../dist/index.js";
import {
  blobStep,
  defineForm,
  ELAPSED_FIELD as SERVER_ELAPSED_FIELD,
  emailStep,
  fromFormData,
  metaFromHeaders,
  normalizeEmail,
  resendMailer,
  toAttachments,
  type DeliveryStep,
  type LineStore,
  type SubmitResult,
} from "../dist/server.js";

const msg = { name: { en: "Name?", ar: "الاسم؟" } } as Record<string, Record<string, string>>;

// The real SDK class fits, so a site passes it straight in.
const mailer = resendMailer({ Resend, from: "Site <site@example.com>", fromEnv: "ENQUIRY_FROM" });
const store: LineStore = { configured: () => true, appendLine: async () => {} };

const enquiry = defineForm({
  name: "enquiry",
  schema: ({ locale }) =>
    z.object({
      name: z.string().min(2, msg.name?.[locale]),
      email: z.email().or(z.literal("")),
      files: z.array(z.instanceof(File)),
    }),
  dedupe: (data) => [normalizeEmail(data.email), data.name],
  deliver: ({ blob, email }) => [
    blob({ store, path: (s) => `enquiries/${s.receivedAt.slice(0, 7)}.jsonl`, required: true }),
    email({
      mailer,
      to: undefined as string | undefined,
      // The step's data is the schema's output.
      subject: (s) => `Enquiry from ${s.data.name}`,
      text: (s) => s.data.email,
      replyTo: (s) => s.data.email || undefined,
      attachments: (s) => toAttachments(s.data.files),
      required: false,
    }),
  ],
});

async function submitEnquiry(_prev: FormState, fd: FormData): Promise<FormState> {
  const result = await enquiry.submit(fromFormData(fd, { multiple: ["files"] }), {
    locale: "en",
    meta: metaFromHeaders(new Headers()),
  });
  if (result.outcome === "delivered") {
    const id: string = result.id;
    void id;
  }
  if (result.outcome === "invalid") {
    const errors: Record<string, string> = result.errors;
    void errors;
  }
  // @ts-expect-error an ignored submission has no id
  void (result.outcome === "ignored" && result.id);
  return result.state;
}
void submitEnquiry;

const typed: SubmitResult<{ name: string }> = { outcome: "ignored", reason: "botid", state: { status: "ok" } };
const field: "website" = HONEYPOT_FIELD;
const props: { name: string; tabIndex: number; autoComplete: string } = honeypotInputProps;
void [typed, field, props];

defineForm({
  name: "typed",
  schema: z.object({ name: z.string() }),
  // @ts-expect-error dedupe reads the schema's output, which has no email
  dedupe: (data) => [data.email],
  deliver: [blobStep({ store, path: () => "x", required: true })],
});

defineForm({
  name: "context",
  schema: z.object({ name: z.string() }),
  deliver: [blobStep({ store, path: () => "x", required: true })],
})
  // @ts-expect-error submit needs a locale
  .submit({}, {});

defineForm({
  name: "misspelt",
  schema: z.object({ name: z.string() }),
  deliver: ({ blob }) => [
    // @ts-expect-error the builders are bound to the schema's output, so a misspelt field fails the build
    blob({ store, path: (s) => s.data.nmae, required: true }),
  ],
});

// A plain array suits steps that are already typed: a site's own, or a step given its data type.
type Lead = { name: string };
const crmStep: DeliveryStep<Lead> = {
  name: "crm",
  required: true,
  configured: () => true,
  run: async (s) => ({ ok: true, ref: s.data.name }),
};
defineForm({
  name: "lead",
  schema: z.object({ name: z.string() }),
  deliver: [crmStep, emailStep<Lead>({ mailer, to: "x", subject: (s) => s.data.name, text: () => "", required: false })],
});

// @ts-expect-error a step must say whether it is required
blobStep({ store, path: () => "x" });

// @ts-expect-error the state has no "sent" status
const wrong: FormState = { status: "sent" };
void wrong;

// @ts-expect-error a mailer needs a sender
resendMailer({ Resend });

// The form clock, from the client entry. Its fields are named for the gate.

const clock: FormClock = createFormClock();
const timeFields: Record<typeof TIMESTAMP_FIELD | typeof ELAPSED_FIELD, string> = clock.fields();
const elapsedName: "te" = ELAPSED_FIELD;
const sameName: typeof ELAPSED_FIELD = SERVER_ELAPSED_FIELD;
clock.stamp(new FormData());
clock.stamp(document.createElement("form"));
clock.reset();
void [timeFields, elapsedName, sameName];

defineForm({
  name: "elapsed",
  schema: z.object({ name: z.string() }),
  gate: { timeTrap: { elapsedField: "open_ms", minMs: 3_000 } },
  deliver: [blobStep({ store, path: () => "x", required: true })],
});

// @ts-expect-error stamp needs a FormData or a form element
clock.stamp({ te: "1" });

defineForm({
  name: "switch",
  schema: z.object({ name: z.string() }),
  // @ts-expect-error the elapsed field is a name, not a switch
  gate: { timeTrap: { elapsedField: false } },
  deliver: [blobStep({ store, path: () => "x", required: true })],
});
