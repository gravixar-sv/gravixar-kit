import type { DeliveryStep, StepOutcome } from "./form.js";
import { env, errorMessage } from "./helpers.js";
import type { Submission } from "./types.js";

type Maybe<T> = T | Promise<T>;

export interface Attachment {
  filename: string;
  /** Bytes, or a base64 string. */
  content: Uint8Array | string;
}

export interface MailMessage {
  to: string | readonly string[];
  subject: string;
  text: string;
  replyTo?: string;
  attachments?: readonly Attachment[];
}

/** Sends one message. `resendMailer` is one; a test or another provider can be another. */
export interface Mailer {
  configured(): boolean;
  /** What a missing configuration needs, for the log. */
  readonly needs?: string;
  /** Returns the failure rather than throwing it. */
  send(message: MailMessage): Promise<StepOutcome>;
}

export interface EmailStepOptions<T> {
  /** Default `"email"`. Set it when a form has two email steps. */
  name?: string;
  mailer: Mailer;
  /** Usually an environment variable. When it is empty, the step isn't configured. */
  to: string | readonly string[] | undefined;
  subject: (submission: Submission<T>) => string;
  text: (submission: Submission<T>) => string;
  replyTo?: (submission: Submission<T>) => string | undefined;
  attachments?: (submission: Submission<T>) => Maybe<readonly Attachment[]>;
  required: boolean;
}

/** Emails each submission. */
export function emailStep<T>(options: EmailStepOptions<T>): DeliveryStep<T> {
  const { mailer, to } = options;
  const recipients = typeof to === "string" ? [to] : (to ?? []);
  const hasRecipient = recipients.some((address) => address.trim() !== "");

  return {
    name: options.name ?? "email",
    required: options.required,
    configured: () => hasRecipient && mailer.configured(),
    get needs() {
      const missing = [];
      if (!mailer.configured()) missing.push(mailer.needs ?? "a mailer");
      if (!hasRecipient) missing.push("a recipient");
      return missing.length > 0 ? missing.join(" and ") : undefined;
    },
    async run(submission) {
      const message: MailMessage = {
        to: recipients,
        subject: options.subject(submission),
        text: options.text(submission),
      };
      const replyTo = options.replyTo?.(submission);
      if (replyTo) message.replyTo = replyTo;
      const attachments = await options.attachments?.(submission);
      if (attachments?.length) message.attachments = attachments;
      return mailer.send(message);
    },
  };
}

/** The part of the Resend SDK the mailer uses. */
export interface ResendClient {
  emails: {
    send(payload: {
      from: string;
      to: string | string[];
      subject: string;
      text: string;
      replyTo?: string;
      attachments?: { filename: string; content: string }[];
    }): Promise<{ data: { id: string } | null; error: { name?: string; message: string } | null }>;
  };
}

/**
 * A mailer over the Resend SDK. Pass the SDK's class (`import { Resend } from "resend"`), so this package doesn't
 * depend on it. The key is read on every send, so one added after boot works without a restart.
 *
 * Resend returns API and network failures as `{ error }` instead of throwing, so a `try/catch` alone sees none of
 * them. This reads `error` on every send, and catches a throw as well.
 */
export function resendMailer(options: {
  Resend: new (key: string) => ResendClient;
  /** Default `"RESEND_API_KEY"`. */
  apiKeyEnv?: string;
  /** The sender, `"Name <address@domain>"`. */
  from: string;
  /** An environment variable that overrides `from` when set. */
  fromEnv?: string;
  /** Used when a step doesn't set its own. */
  replyTo?: string;
  replyToEnv?: string;
}): Mailer & { client(): ResendClient | null; readonly from: string; readonly replyTo: string | undefined } {
  const apiKeyEnv = options.apiKeyEnv ?? "RESEND_API_KEY";
  let client: ResendClient | null = null;
  let clientKey: string | undefined;

  const mailer = {
    needs: apiKeyEnv,
    configured: () => Boolean(env(apiKeyEnv)),
    /** The SDK client, built once per key. `null` without a key. */
    client(): ResendClient | null {
      const key = env(apiKeyEnv);
      if (!key) return null;
      if (!client || clientKey !== key) {
        client = new options.Resend(key);
        clientKey = key;
      }
      return client;
    },
    get from() {
      return (options.fromEnv && env(options.fromEnv)) || options.from;
    },
    get replyTo() {
      return (options.replyToEnv && env(options.replyToEnv)) || options.replyTo;
    },
    async send(message: MailMessage): Promise<StepOutcome> {
      const resend = mailer.client();
      if (!resend) return { ok: false, error: `${apiKeyEnv} is not set` };
      const replyTo = message.replyTo ?? mailer.replyTo;
      try {
        const { data, error } = await resend.emails.send({
          from: mailer.from,
          to: typeof message.to === "string" ? message.to : [...message.to],
          subject: message.subject,
          text: message.text,
          ...(replyTo ? { replyTo } : {}),
          ...(message.attachments?.length
            ? {
                attachments: message.attachments.map(({ filename, content }) => ({
                  filename,
                  // The SDK puts content into a JSON body as it is, where bytes would not survive; base64 does.
                  content: typeof content === "string" ? content : base64(content),
                })),
              }
            : {}),
        });
        if (error) return { ok: false, error: `${error.name ?? "error"}: ${error.message}` };
        if (!data?.id) return { ok: false, error: "Resend returned neither an id nor an error" };
        return { ok: true, ref: data.id };
      } catch (error) {
        return { ok: false, error: errorMessage(error) };
      }
    },
  };
  return mailer;
}

/** Uploaded files as attachments, with names reduced to safe characters. */
export async function toAttachments(files: readonly File[]): Promise<Attachment[]> {
  return Promise.all(
    files.map(async (file) => ({
      filename: file.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120),
      content: new Uint8Array(await file.arrayBuffer()),
    })),
  );
}

function base64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(binary);
}

/** Appends one line to a file. A site adapts its storage to this: Vercel Blob, a bucket, a database table. */
export interface LineStore {
  configured(): boolean;
  /** What a missing configuration needs, for the log. */
  readonly needs?: string;
  /** Throws when the line wasn't written. */
  appendLine(path: string, line: string): Promise<void>;
}

export interface BlobStepOptions<T> {
  /** Default `"blob"`. */
  name?: string;
  store: LineStore;
  path: (submission: Submission<T>) => string;
  /** The record to write. Default: the whole submission. */
  toLine?: (submission: Submission<T>) => unknown;
  required: boolean;
}

/**
 * Appends each submission as one JSON line: the format a CRM sync reads month by month. By default the line is
 * the whole submission; `toLine` returns the record to write instead. Files in the data don't survive JSON.
 */
export function blobStep<T>(options: BlobStepOptions<T>): DeliveryStep<T> {
  const { store } = options;
  const step: DeliveryStep<T> = {
    name: options.name ?? "blob",
    required: options.required,
    configured: () => store.configured(),
    async run(submission) {
      const path = options.path(submission);
      const line = JSON.stringify(options.toLine ? options.toLine(submission) : submission);
      if (line === undefined) return { ok: false, error: "toLine returned nothing to write" };
      await store.appendLine(path, line);
      return { ok: true, ref: path };
    },
  };
  return store.needs ? { ...step, needs: store.needs } : step;
}
