/*
 * @gravixar/forms/server: everything that runs a submission. Import it from server actions and route handlers only.
 *
 * A form defines its schema, gate, identity and delivery once; `submit` then runs them in the order the live forms
 * do: the bot gate on the raw input, validation, the id, then every delivery step. In production a required step
 * that isn't configured fails the submission, so a missing key shows the visitor an error instead of losing what
 * they sent.
 */

export { defineForm, FormError } from "./form.js";
export type { BotIdVerdict, DeliveryStep, Form, FormDefinition, InferOutput, StepBuilders, StepOutcome, SubmitContext } from "./form.js";
export { checkGate, MAX_FORM_AGE_MS, MIN_FILL_MS } from "./gate.js";
export type { GateOptions, GateVerdict } from "./gate.js";
export { fromFormData, metaFromHeaders, normalizeEmail, stableId } from "./helpers.js";
export type { FormValue } from "./helpers.js";
export { blobStep, emailStep, resendMailer, toAttachments } from "./steps.js";
export type { Attachment, BlobStepOptions, EmailStepOptions, LineStore, MailMessage, Mailer, ResendClient } from "./steps.js";
export { ELAPSED_FIELD, HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD, TIMESTAMP_FIELD, honeypotInputProps } from "./fields.js";
export type { StandardIssue, StandardResult, StandardSchema } from "./standard-schema.js";
export type { Evidence, FormState, GateReason, Submission, SubmissionMeta, SubmitResult } from "./types.js";
