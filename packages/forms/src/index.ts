/*
 * @gravixar/forms: the client-safe entry. A form component imports the field names, the form clock and the types
 * from here. Everything that runs a submission is in `@gravixar/forms/server`: a client component that imports
 * server code ships it to the browser, so nothing reachable from this file may import a Node builtin or server code.
 * A test walks this entry's module graph to hold that.
 */

export { createFormClock } from "./clock.js";
export type { FormClock } from "./clock.js";
export { ELAPSED_FIELD, HONEYPOT_FIELD, TIMESTAMP_FIELD, honeypotInputProps } from "./fields.js";
export type { Evidence, FormState, GateReason, SubmitResult } from "./types.js";
