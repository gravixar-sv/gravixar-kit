import { ELAPSED_FIELD, HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD, TIMESTAMP_FIELD } from "./fields.js";
import { checkGate, gateFields, type GateOptions } from "./gate.js";
import { errorMessage, isProduction, randomId, stableId } from "./helpers.js";
import { blobStep, emailStep, type BlobStepOptions, type EmailStepOptions } from "./steps.js";
import type { StandardIssue, StandardSchema } from "./standard-schema.js";
import type { Evidence, FormState, GateReason, Submission, SubmissionMeta, SubmitResult } from "./types.js";

/** A form definition that can't work. Thrown when the module loads, so it fails the site's build. */
export class FormError extends Error {
  override name = "FormError";
}

/** Vercel BotID's verdict, from `checkBotId()` in `botid/server`. */
export interface BotIdVerdict {
  isBot?: boolean;
  isVerifiedBot?: boolean;
}

/** What a step reports. The form adds the step's name and the time to make its `Evidence`. */
export type StepOutcome = { ok: true; ref?: string } | { ok: false; error: string };

/** One place a submission goes. `emailStep` and `blobStep` are two; a site can write its own. */
export interface DeliveryStep<T> {
  readonly name: string;
  /** A required step that fails makes the submission `failed`. At least one step must be required. */
  readonly required: boolean;
  /** False when a key, token or address is missing. */
  configured(): boolean;
  /** What a missing configuration needs, for the log: `"RESEND_API_KEY"`. */
  readonly needs?: string;
  /** Returns the failure rather than throwing it; a throw is caught and recorded the same way. */
  run(submission: Submission<T>): Promise<StepOutcome>;
}

/** The output type of a Standard Schema validator. */
export type InferOutput<S extends StandardSchema> = NonNullable<S["~standard"]["types"]>["output"];

export interface FormDefinition<S extends StandardSchema, T = InferOutput<S>> {
  /** Lower-case id: the record's kind, the dedupe namespace and the log prefix. */
  name: string;
  /** A Standard Schema validator (zod v4 is one), or a function that builds one per locale for its messages. */
  schema: S | ((context: { locale: string }) => S);
  gate?: GateOptions & {
    /** Blocks unverified bots. For forms that email an address the caller supplies. */
    botId?: () => Promise<BotIdVerdict>;
  };
  /** Parts that identify a submission, hashed with the form's name into its id. Omit for a random id. */
  dedupe?: (data: T) => readonly string[];
  /**
   * Run in order. Every step runs, so one failing doesn't stop another from delivering.
   *
   * Write it as a function of the step builders, `({ email, blob }) => [...]`: they are bound to the schema's output,
   * so each step's callbacks see typed data. TypeScript can't carry that type into `emailStep(...)` calls in a plain
   * array; a plain array suits steps that are already typed, such as a site's own.
   */
  deliver: readonly DeliveryStep<T>[] | ((steps: StepBuilders<T>) => readonly DeliveryStep<T>[]);
}

/** `emailStep` and `blobStep`, bound to a form's data type. */
export interface StepBuilders<T> {
  email(options: EmailStepOptions<T>): DeliveryStep<T>;
  blob(options: BlobStepOptions<T>): DeliveryStep<T>;
}

export interface SubmitContext {
  locale: string;
  meta?: SubmissionMeta;
}

export interface Form<T> {
  readonly name: string;
  /** Gate, then validation, then the id, then every delivery step. Resolves; it doesn't throw for a bad submission. */
  submit(input: Record<string, unknown>, context: SubmitContext): Promise<SubmitResult<T>>;
}

const OK: FormState = { status: "ok" };

/** Defines a form. Throws a `FormError` when the definition can't work, so the mistake fails the build. */
export function defineForm<S extends StandardSchema>(definition: FormDefinition<S>): Form<InferOutput<S>> {
  type T = InferOutput<S>;
  const { name, schema, gate = {}, dedupe } = definition;
  const deliver =
    typeof definition.deliver === "function"
      ? definition.deliver({ email: emailStep, blob: blobStep })
      : definition.deliver;
  const log = `[forms:${name}]`;

  if (!/^[a-z][a-z0-9-]*$/.test(name)) {
    throw new FormError(`Form name "${name}" must be a lower-case id, such as "enquiry".`);
  }
  if (!deliver.some((step) => step.required)) {
    throw new FormError(`${log} needs at least one required delivery step, or a failed delivery would pass as success.`);
  }
  const stepNames = deliver.map((step) => step.name);
  const repeated = stepNames.find((step, i) => stepNames.indexOf(step) !== i);
  if (repeated) throw new FormError(`${log} has two delivery steps named "${repeated}". Give one a \`name\`.`);

  const fields = gateFields(gate);
  if (gate.timeTrap !== false) {
    const timestamp = gate.timeTrap?.field ?? TIMESTAMP_FIELD;
    const elapsed = gate.timeTrap?.elapsedField ?? ELAPSED_FIELD;
    if (timestamp === elapsed) {
      throw new FormError(`${log} uses "${timestamp}" for both the timestamp and the elapsed time.`);
    }
    if (gate.honeypot !== false) {
      const honeypots = [gate.honeypot ?? HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD];
      if (honeypots.includes(timestamp)) {
        throw new FormError(`${log} uses "${timestamp}" for both the honeypot and the timestamp.`);
      }
      if (honeypots.includes(elapsed)) {
        throw new FormError(`${log} uses "${elapsed}" for both the honeypot and the elapsed time.`);
      }
    }
  }
  if (gate.timeTrap) {
    const { minMs = 0, maxAgeMs = Infinity } = gate.timeTrap;
    if (!(minMs >= 0 && maxAgeMs > minMs)) {
      throw new FormError(`${log} time trap needs 0 <= minMs < maxAgeMs, not ${minMs} and ${maxAgeMs}.`);
    }
  }
  if (typeof schema !== "function") assertNoClash(schema);

  function assertNoClash(built: S) {
    const clash = schemaKeys(built)?.find((key) => fields.includes(key));
    if (clash) {
      throw new FormError(
        `${log} validates "${clash}", which the gate reads and removes. Rename the field, or set the gate's field.`,
      );
    }
  }

  function ignored(reason: GateReason): SubmitResult<T> {
    // Silent to the bot, never to us: browsers autofill hidden fields, and this is the one path that can drop a
    // real person without an error or a record.
    console.warn(`${log} ignored a submission: ${reason}`);
    return { outcome: "ignored", reason, state: OK };
  }

  return {
    name,
    async submit(input, context) {
      const verdict = checkGate(input, gate);
      if (!verdict.ok) return ignored(verdict.reason);

      if (gate.botId) {
        let bot: BotIdVerdict | undefined;
        try {
          bot = await gate.botId();
        } catch (error) {
          // Fail open: the static gate has already passed, and dropping a real person silently is the worse error.
          console.error(`${log} BotID check failed, so it was skipped: ${errorMessage(error)}`);
        }
        if (bot?.isBot && !bot.isVerifiedBot) return ignored("botid");
      }

      const built = typeof schema === "function" ? schema({ locale: context.locale }) : schema;
      if (typeof schema === "function") assertNoClash(built);
      const values: Record<string, unknown> = { ...input };
      for (const field of fields) delete values[field];
      const result = await built["~standard"].validate(values);
      if (result.issues) {
        const errors = firstErrors(result.issues);
        return { outcome: "invalid", errors, state: { status: "error", errors } };
      }

      const data = result.value as T;
      const submission: Submission<T> = {
        id: dedupe ? await stableId([name, ...dedupe(data)]) : randomId(),
        form: name,
        data,
        locale: context.locale,
        meta: context.meta ?? {},
        receivedAt: new Date().toISOString(),
      };

      const production = isProduction();
      const evidence: Evidence[] = [];
      let failed = false;
      for (const step of deliver) {
        const record = await runStep(step, submission, production, log);
        evidence.push(record);
        if (!record.ok && step.required) failed = true;
      }

      return failed
        ? { outcome: "failed", id: submission.id, evidence, state: { status: "error" } }
        : { outcome: "delivered", id: submission.id, evidence, state: OK };
    },
  };
}

async function runStep<T>(
  step: DeliveryStep<T>,
  submission: Submission<T>,
  production: boolean,
  log: string,
): Promise<Evidence> {
  const at = () => new Date().toISOString();
  const needs = step.needs ? ` (needs ${step.needs})` : "";

  if (!step.configured()) {
    if (!production) {
      console.info(`${log} dry run: "${step.name}" is not configured${needs}, submission ${submission.id}`);
      return { step: step.name, ok: true, dryRun: true, at: at() };
    }
    console.error(`${log} "${step.name}" is not configured${needs}, so submission ${submission.id} was not sent there`);
    return { step: step.name, ok: false, error: `not configured${needs}`, at: at() };
  }

  let outcome: StepOutcome;
  try {
    outcome = await step.run(submission);
  } catch (error) {
    outcome = { ok: false, error: errorMessage(error) };
  }
  if (!outcome.ok) {
    console.error(`${log} "${step.name}" failed for submission ${submission.id}: ${outcome.error}`);
    return { step: step.name, ok: false, error: outcome.error, at: at() };
  }
  return outcome.ref === undefined
    ? { step: step.name, ok: true, at: at() }
    : { step: step.name, ok: true, ref: outcome.ref, at: at() };
}

/** The first message per field path; an issue with no path is keyed `form`. */
function firstErrors(issues: readonly StandardIssue[]): Record<string, string> {
  const errors: Record<string, string> = {};
  for (const issue of issues) {
    const key = (issue.path ?? []).map((part) => String(typeof part === "object" ? part.key : part)).join(".") || "form";
    errors[key] ??= issue.message;
  }
  return errors;
}

/** An object schema's field names, where the validator exposes them: zod's `shape`, valibot's `entries`. */
function schemaKeys(schema: object): string[] | undefined {
  for (const property of ["shape", "entries"]) {
    const value = (schema as Record<string, unknown>)[property];
    if (typeof value === "object" && value !== null) return Object.keys(value);
  }
  return undefined;
}
