/*
 * @gravixar/forms: the client-safe entry. A form component imports the field names and types from here. Everything
 * that runs a submission is in `@gravixar/forms/server`: a client component that imports server code ships it to
 * the browser, so nothing reachable from this file may import a Node builtin or server code. A test walks this
 * entry's module graph to hold that.
 */

export { HONEYPOT_FIELD, TIMESTAMP_FIELD, honeypotInputProps } from "./fields.js";
export type { Evidence, FormState, GateReason, SubmitResult } from "./types.js";
