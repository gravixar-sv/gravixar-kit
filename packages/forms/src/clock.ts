import { ELAPSED_FIELD, TIMESTAMP_FIELD } from "./fields.js";

/**
 * Times a form in the browser, for the gate's time trap. Create it anywhere in the browser, for example when the form
 * mounts: the first submission is timed from when the page began to load, whenever the clock is created.
 */
export interface FormClock {
  /**
   * Both time fields, as strings: `ts`, when timing started by the device's clock (the page load, or the last
   * `reset()`), and `te`, the milliseconds since then.
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
 * A clock for one form. It measures with `performance.now()`, which never jumps when the device's clock is corrected,
 * so the elapsed time is never negative and doesn't depend on the clock being right.
 *
 * The first submission is timed from when the page began to load, which is 0 on `performance.now()`'s timeline, not
 * from when the clock is created. A server-rendered form can be seen and filled before React hydrates it, and the
 * clock is created at hydration at the earliest. On a slow phone, or inside a `<Suspense>` boundary, that is seconds
 * later. A clock that started then undercounted by the whole wait, so a person who typed while the page hydrated and
 * pressed send within two seconds of it finishing was ignored as too fast while they saw "sent". After a client-side
 * navigation it still counts from the first page of the visit, which only makes it more lenient. A bot that loads a
 * page and posts within two seconds is still caught.
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

  // `start` stays 0, the page load. Without `performance` there is no page timeline, so timing starts now.
  if (typeof performance === "undefined") reset();
  else openedAt = Math.round(Date.now() - performance.now());
  return { fields, stamp, reset };
}

function monotonic(): number {
  return typeof performance === "undefined" ? Date.now() : performance.now();
}
