import { HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD, TIMESTAMP_FIELD } from "./fields.js";
import type { GateReason } from "./types.js";

/** The fastest a person fills a form, in milliseconds. */
export const MIN_FILL_MS = 2_000;
/** A form older than this was cached or replayed, in milliseconds. */
export const MAX_FORM_AGE_MS = 24 * 60 * 60 * 1000;

export interface GateOptions {
  /** The honeypot field. Default `"website"`; `"hp_website"` is always checked too. `false` turns it off. */
  honeypot?: string | false;
  /** The time trap. On by default, and a missing timestamp fails it. `false` turns it off. */
  timeTrap?: { field?: string; minMs?: number; maxAgeMs?: number } | false;
}

export type GateVerdict = { ok: true } | { ok: false; reason: GateReason };

/** The field names the gate reads, so they can be kept out of validation. */
export function gateFields(options: GateOptions = {}): string[] {
  const fields = new Set<string>();
  if (options.honeypot !== false) fields.add(options.honeypot ?? HONEYPOT_FIELD).add(LEGACY_HONEYPOT_FIELD);
  if (options.timeTrap !== false) fields.add(options.timeTrap?.field ?? TIMESTAMP_FIELD);
  return [...fields];
}

/**
 * The bot gate, on the raw input, before validation: a validator that rejected a filled honeypot would name the
 * field in its error, telling a bot exactly what to leave empty. Pure and synchronous; BotID is a form option.
 *
 * An absent value is `undefined` or `null`. Anything else in the honeypot other than blank text trips it.
 */
export function checkGate(input: Record<string, unknown>, options: GateOptions = {}, nowMs = Date.now()): GateVerdict {
  if (options.honeypot !== false) {
    for (const field of [options.honeypot ?? HONEYPOT_FIELD, LEGACY_HONEYPOT_FIELD]) {
      if (filled(input[field])) return { ok: false, reason: "honeypot_filled" };
    }
  }

  if (options.timeTrap !== false) {
    const { field = TIMESTAMP_FIELD, minMs = MIN_FILL_MS, maxAgeMs = MAX_FORM_AGE_MS } = options.timeTrap ?? {};
    const raw = input[field];
    if (raw === undefined || raw === null || raw === "") return { ok: false, reason: "ts_missing" };
    if (typeof raw !== "string" && typeof raw !== "number") return { ok: false, reason: "ts_invalid" };
    const ts = Number(raw);
    if (!Number.isFinite(ts)) return { ok: false, reason: "ts_invalid" };
    const age = nowMs - ts;
    if (age < minMs) return { ok: false, reason: "ts_too_fast" };
    if (age > maxAgeMs) return { ok: false, reason: "ts_stale" };
  }

  return { ok: true };
}

function filled(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === "string") return value.trim().length > 0;
  return true;
}
