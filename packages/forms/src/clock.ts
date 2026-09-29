import { ELAPSED_FIELD, TIMESTAMP_FIELD } from "./fields.js";

/** Times a form in the browser, for the gate's time trap. Create it when the form mounts. */
export interface FormClock {
  /**
   * Both time fields, as strings: `ts`, the time the form opened by the device's clock, and `te`, how long it has
   * been open in milliseconds.
   */
  fields(): { ts: string; te: string };
  /**
   * Writes both fields into `FormData`, replacing any value, or into a form's inputs of those names, adding a hidden
   * input for any that is missing. Call it in the form's `submit` handler.
   */
  stamp(target: FormData | HTMLFormElement): void;
  /** Starts timing from now. Call it after a successful submission, so the next one from the same tab is timed anew. */
  reset(): void;
}

/**
 * A clock for one form. It measures how long the form was open with `performance.now()`, which never jumps when the
 * device's clock is corrected, so the elapsed time is never negative and doesn't depend on the clock being right.
 */
export function createFormClock(): FormClock {
  let openedAt = 0;
  let start = 0;

  function reset(): void {
    openedAt = Date.now();
    start = monotonic();
  }

  function fields(): { ts: string; te: string } {
    return { [TIMESTAMP_FIELD]: String(openedAt), [ELAPSED_FIELD]: String(Math.round(monotonic() - start)) };
  }

  function stamp(target: FormData | HTMLFormElement): void {
    for (const [name, value] of Object.entries(fields())) {
      if (!("elements" in target)) {
        target.set(name, value);
        continue;
      }
      let input = target.elements.namedItem(name) as HTMLInputElement | null;
      if (!input) {
        input = target.ownerDocument.createElement("input");
        input.type = "hidden";
        input.name = name;
        target.append(input);
      }
      input.value = value;
    }
  }

  reset();
  return { fields, stamp, reset };
}

function monotonic(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
