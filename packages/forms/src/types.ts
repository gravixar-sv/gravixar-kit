// Types shared by both entry points. This module has no runtime code.

/** What a server action returns to `useActionState`. A bot and a person get the same "ok". */
export type FormState = { status: "idle" | "ok" | "error"; errors?: Record<string, string> };

/** Why the gate ignored a submission. For logs only: never tell the client which check tripped. */
export type GateReason = "honeypot_filled" | "ts_missing" | "ts_invalid" | "ts_too_fast" | "ts_stale" | "botid";

/** What one delivery step did with a submission. */
export interface Evidence {
  step: string;
  ok: boolean;
  /** Where it went: an email id, a file path. */
  ref?: string;
  error?: string;
  /** The step wasn't configured outside production, so it only logged the submission. */
  dryRun?: boolean;
  at: string;
}

/** Request details kept with a submission, for forensics. */
export interface SubmissionMeta {
  ip?: string;
  userAgent?: string;
}

/** A validated submission, as the delivery steps receive it. */
export interface Submission<T> {
  /** 32 hex characters: derived from the form's `dedupe` parts, or random. */
  id: string;
  form: string;
  data: T;
  locale: string;
  meta: SubmissionMeta;
  receivedAt: string;
}

export type SubmitResult<T> =
  /** Every required step delivered. */
  | { outcome: "delivered"; id: string; evidence: Evidence[]; state: FormState }
  /** The gate stopped a bot. Its state is the same "ok" a person gets. */
  | { outcome: "ignored"; reason: GateReason; state: FormState }
  /** The first error per field path, in the locale's messages. */
  | { outcome: "invalid"; errors: Record<string, string>; state: FormState }
  /** A required step failed. Show the localized error and a fallback contact. */
  | { outcome: "failed"; id: string; evidence: Evidence[]; state: FormState };
