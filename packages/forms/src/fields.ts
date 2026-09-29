/*
 * The field names a form component renders and the server checks. Both entry points export them from here, so the
 * hidden inputs and the gate can't drift apart. This module imports nothing: it is part of the client entry's graph.
 */

/** The honeypot. It is rendered off-screen, so a person never fills it and a bot that fills every input does. */
export const HONEYPOT_FIELD = "website";

/**
 * The time the form was rendered, in Unix milliseconds, set once when the form mounts. It is the browser's clock
 * compared with the server's, so a device clock that is minutes off skews it. The gate uses it only when
 * `ELAPSED_FIELD` is absent or unusable.
 */
export const TIMESTAMP_FIELD = "ts";

/**
 * How long the form was open, in milliseconds, measured in the browser at submit. Both ends of the measurement are
 * the browser's clock, so a device clock that is off doesn't change it. When it is a finite, non-negative number
 * the gate uses it instead of `TIMESTAMP_FIELD`; anything else is ignored. `createFormClock()` sets both.
 */
export const ELAPSED_FIELD = "te";

/**
 * The honeypot name Gravixar's private backend package used. The gate accepts it as well, so forms that render it
 * keep working when that package re-exports this one.
 */
export const LEGACY_HONEYPOT_FIELD = "hp_website";

/**
 * Spread onto the honeypot `<input>`. Keyboard users can't tab into it and autofill leaves it alone. Place it
 * off-screen with CSS, not `display: none`, which some bots skip.
 */
export const honeypotInputProps = { name: HONEYPOT_FIELD, tabIndex: -1, autoComplete: "off" } as const;
