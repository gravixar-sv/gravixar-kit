import { ELAPSED_FIELD, HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD, TIMESTAMP_FIELD } from "./fields.js";
import type { GateReason } from "./types.js";

/** The fastest a person fills a form, in milliseconds. */
export const MIN_FILL_MS = 2_000;
/** A form older than this was cached or replayed, in milliseconds. Checked only on the timestamp path. */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

export interface GateOptions {
  /** The honeypot field. Default `"website"`; `"hp_website"` is always checked too. `false` turns it off. */
  honeypot?: string | false;
  /**
   * The time trap. On by default. It reads the elapsed field when the form sends a usable one (a finite,
   * non-negative number), and the timestamp otherwise; a form that sends neither fails it. `false` turns it off.
   */
  timeTrap?:
    | {
        /** The timestamp field. Default `"ts"`. */
        field?: string;
        /** The elapsed-time field. Default `"te"`. */
        elapsedField?: string;
        minMs?: number;
        /** Applies to the timestamp only: an elapsed time measured in the browser has no age to check. */
        maxAgeMs?: number;
      }
    | false;
}

export type GateVerdict = { ok: true } | { ok: false; reason: GateReason };

/** The field names the gate reads, so they can be kept out of validation. */
export function gateFields(options: GateOptions = {}): string[] {
  const fields = new Set<string>();
  if (options.honeypot !== false) fields.add(options.honeypot ?? HONEYPOT_FIELD).add(LEGACY_HONEYPOT_FIELD);
  if (options.timeTrap !== false) {
    fields.add(options.timeTrap?.field ?? TIMESTAMP_FIELD).add(options.timeTrap?.elapsedField ?? ELAPSED_FIELD);
  }
  return [...fields];
}

/**
 * The bot gate, on the raw input, before validation: a validator that rejected a filled honeypot would name the
 * field in its error, telling a bot exactly what to leave empty. Pure and synchronous; BotID is a form option.
 *
 * An absent value is `undefined`, `null` or `""`. Anything else in the honeypot other than blank text trips it.
 *
 * The time trap prefers the elapsed field, which the browser measures against its own clock, so a device clock that
 * is minutes off can't make a person look too fast or too old. It has no age limit: a tab left open for days is a
 * person, and a replayed request would carry its old elapsed time anyway. An elapsed value that isn't a finite,
 * non-negative number is ignored rather than rejected: a hand-rolled `Date.now() - mount` goes negative when the
 * device's clock is corrected mid-fill, and a bot gains nothing, since it could leave the field out. Without a usable
 * one, the timestamp is compared with the server's clock, as before.
 */
export function checkGate(input: Record<string, unknown>, options: GateOptions = {}, nowMs = Date.now()): GateVerdict {
  if (options.honeypot !== false) {
    for (const field of [options.honeypot ?? HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD]) {
      if (filled(input[field])) return { ok: false, reason: "honeypot_filled" };
    }
  }

  if (options.timeTrap !== false) {
    const {
      field = TIMESTAMP_FIELD,
      elapsedField = ELAPSED_FIELD,
      minMs = MIN_FILL_MS,
      maxAgeMs = MAX_FORM_AGE_MS,
    } = options.timeTrap ?? {};

    const elapsed = elapsedMs(input[elapsedField]);
    if (elapsed !== undefined) return elapsed < minMs ? { ok: false, reason: "ts_too_fast" } : { ok: true };

    const raw = input[field];
    if (absent(raw)) return { ok: false, reason: "ts_missing" };
    const ts = toNumber(raw);
    if (ts === undefined) return { ok: false, reason: "ts_invalid" };
    const age = nowMs - ts;
    if (age < minMs) return { ok: false, reason: "ts_too_fast" };
    if (age > maxAgeMs) return { ok: false, reason: "ts_stale" };
  }

  return { ok: true };
}

function absent(value: unknown): boolean {
  return value === undefined || value === null || value === "";
}

/** A usable elapsed time: a finite, non-negative number or numeric string. Anything else, blank included, is unusable. */
function elapsedMs(value: unknown): number | undefined {
  if (typeof value === "string" && value.trim() === "") return undefined;
  const n = toNumber(value);
  return n !== undefined && n >= 0 ? n : undefined;
}

/** A finite number, from a number or a numeric string; otherwise undefined. */
function toNumber(value: unknown): number | undefined {
  if (typeof value !== "string" && typeof value !== "number") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}
