import { contrast, isHex } from "./color.js";
import { previewScript } from "./preview.js";

export { contrast, isHex, tint } from "./color.js";

/*
 * Design as data. A site lists its design choices as axes of options (colour presets, heading typefaces) and
 * this turns them into CSS custom properties. Three rules come with it: text below the contrast floor fails
 * the build, a saved id that no longer exists falls back to the default, and a client's choice is saved as a
 * reference to an option plus only the values they changed, so a later fix to that option still reaches them.
 */

/** A token's value: a colour, a font stack, a weight. It renders as a CSS custom property. */
export type TokenValue = string | number;
export type Tokens = { readonly [name: string]: TokenValue };

/** One option, as data: its tokens, any values that change per language, and whatever else the site keeps with it. */
export interface Option {
  /** Keyed in camelCase, so `goldHi` renders as `--gold-hi`. Every option on an axis sets the same keys. */
  readonly tokens: Tokens;
  /** Values that change for a language: `{ ar: { display: "..." } }` renders under `:lang(ar)`. */
  readonly lang?: { readonly [lang: string]: Tokens };
}

type Options = { readonly [id: string]: Option };
type TokensOf<O extends Options> = O[keyof O]["tokens"];
type TokenOf<O extends Options> = keyof TokensOf<O> & string;

/** A set of options to choose one from, such as colour presets or heading typefaces. */
export interface Axis<O extends Options = Options> {
  /** Every option, keyed by id. Never rename an id once a client may have saved it. */
  readonly options: O;
  /** The option used when nothing is saved, or when a saved id no longer exists. */
  readonly default: keyof O & string;
  /** Properties computed from the tokens, such as washes of a brand colour. They follow a client's changes. */
  readonly derive?: (tokens: TokensOf<O>) => Tokens;
  /**
   * Text and background tokens that must stay readable together. Every option is checked when the theme is
   * defined, so an unreadable preset fails the build; a client's changes are checked before they render or save.
   */
  readonly contrast?: {
    readonly pairs: readonly (readonly [text: TokenOf<O>, background: TokenOf<O>])[];
    /** The WCAG 2 ratio to hold. Default 4.5, AA for body text. */
    readonly floor?: number;
  };
  /** The attribute that applies an option to an element, and to `<html>` during a preview. Default `data-<axis>`. */
  readonly attribute?: string;
}

/** Declares one axis, so its token names are checked in `default`, `derive` and `contrast`. */
export function axis<const O extends Options>(def: Axis<O>): Axis<O> {
  return def;
}

type Axes = { readonly [name: string]: Axis<any> };
type IdOf<X> = X extends Axis<infer O> ? keyof O & string : never;

/** A choice ready to render: an option on every axis, plus the colours the client changed. */
export type Choice<A extends Axes> = { readonly [K in keyof A]: IdOf<A[K]> } & {
  readonly changes: { readonly [token: string]: string };
};

/** A choice as a site saves it, e.g. content/theme.json: an option id per axis and only the changed colours. */
export type Saved<A extends Axes> = { readonly [K in keyof A]?: string } & {
  readonly changes?: { readonly [token: string]: string };
};

export interface ThemeDefinition<A extends Axes> {
  readonly axes: A;
  /** Prefix for the sessionStorage keys that hold a preview (`<prefix>preview-<axis>`), so sites on one origin stay apart. */
  readonly preview?: { readonly keyPrefix?: string };
}

export interface AxisInfo<Id extends string> {
  readonly ids: readonly Id[];
  readonly default: Id;
  readonly attribute: string;
  /** The preview query parameter, `?<param>=<id>`. */
  readonly param: string;
  readonly storageKey: string;
}

export interface Theme<A extends Axes> {
  /** What an editor or a preview control needs about each axis. */
  readonly axes: { readonly [K in keyof A]: AxisInfo<IdOf<A[K]>> };
  /** Reads a saved choice leniently: a missing or unknown id becomes the default and an invalid change is dropped. Never throws. */
  resolve(saved: unknown): Choice<A>;
  /** Everything resolve() would correct or drop in a saved choice, and any change that makes text unreadable. Empty when all is well. */
  problems(saved: unknown): string[];
  /** The minimal form to save: an id per axis and only the colours that differ from the chosen option. Throws on any problem. */
  store(selection: Saved<A>): Saved<A>;
  /**
   * The CSS for `<head>`: the chosen options at `:root` with the client's changes, then every option under its
   * attribute, so a preview or a side-by-side sample is complete. Throws if the changes make text unreadable.
   */
  css(saved?: Saved<A> | Choice<A>): string;
  /**
   * A Tailwind v4 `@theme inline` block mapping each colour token to utilities (`--gold` gives `bg-gold`). The
   * utilities read the runtime variables, so presets, previews and scoped samples keep working. Other tokens
   * are mapped by name: `{ display: "--font-display" }`.
   */
  tailwind(extra?: { readonly [token: string]: string }): string;
  /** The inline script for `<head>` that applies `?<axis>=<id>` previews before first paint. */
  previewScript(): string;
}

/** A theme that can't be defined, or a choice that can't be saved or rendered, with every problem listed. */
export class ThemeError extends Error {
  override readonly name = "ThemeError";
  readonly problems: readonly string[];
  constructor(summary: string, problems: readonly string[]) {
    super(`${summary}:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.problems = Object.freeze([...problems]);
  }
}

const AXIS_NAME = /^[a-z][a-z0-9-]*$/;
const OPTION_ID = /^[a-z0-9][a-z0-9-]*$/;
const TOKEN_NAME = /^[a-z][A-Za-z0-9]*$/;
const ATTRIBUTE = /^data-[a-z0-9-]+$/;
const LANG = /^[A-Za-z]{2,3}(-[A-Za-z0-9]{1,8})*$/;
const KEY_PREFIX = /^[A-Za-z0-9_-]*$/;
const CSS_VAR = /^--[a-z0-9-]+$/;
/** Characters that could close the declaration block, or the `<style>` element, a value is rendered into. */
const UNSAFE = /[{}<]/;

const kebab = (name: string) => name.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`);
const declarations = (tokens: Tokens) =>
  Object.entries(tokens).map(([name, value]) => `--${kebab(name)}:${value}`).join(";");
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const show = (value: unknown) => JSON.stringify(value) ?? String(value);

/** A copy of the tokens with every usable value; each unusable one is reported. */
function usable(raw: Record<string, unknown>, where: string, problems: string[]): Tokens {
  const out: Record<string, TokenValue> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!TOKEN_NAME.test(name)) problems.push(`${where}: token name ${show(name)} must be camelCase letters and digits`);
    const ok =
      typeof value === "number" ? Number.isFinite(value) : typeof value === "string" && value.trim() !== "" && !UNSAFE.test(value);
    if (ok) out[name] = value as TokenValue;
    else problems.push(`${where}: ${name} is ${show(value)}; a value is a finite number, or text without "{", "}" or "<"`);
  }
  return Object.freeze(out);
}

interface CompiledOption {
  readonly tokens: Tokens;
  readonly lang: readonly (readonly [tag: string, tokens: Tokens])[];
}

interface CompiledAxis {
  readonly name: string;
  readonly ids: readonly string[];
  readonly default: string;
  readonly attribute: string;
  readonly storageKey: string;
  readonly options: ReadonlyMap<string, CompiledOption>;
  readonly derive: ((tokens: Tokens) => Tokens) | undefined;
  readonly pairs: readonly (readonly [string, string])[];
  readonly floor: number;
  /** Tokens that are a #RRGGBB colour in every option: the only tokens a client may change. */
  readonly colors: ReadonlySet<string>;
}

/**
 * Checks and compiles a theme. Anything wrong with the definition (an unreadable preset, an option missing a
 * token, an unknown default) throws here, when the site's theme module loads, so it fails the build rather
 * than a page. The site's own objects are copied, never frozen or kept, so changing them later has no effect.
 */
export function defineTheme<const A extends Axes>(definition: ThemeDefinition<A>): Theme<A> {
  const problems: string[] = [];
  const keyPrefix = definition.preview?.keyPrefix ?? "";
  if (!KEY_PREFIX.test(keyPrefix)) problems.push(`preview.keyPrefix ${show(keyPrefix)} may only use letters, digits, "-" and "_"`);

  const entries = Object.entries(isRecord(definition.axes) ? (definition.axes as Axes) : {});
  if (entries.length === 0) problems.push("a theme needs at least one axis");

  const compiled: CompiledAxis[] = [];
  const owner = new Map<string, string>(); // every rendered token name -> the axis that sets it
  const derived = new Set<string>();

  for (const [name, def] of entries) {
    const where = `axis "${name}"`;
    if (!AXIS_NAME.test(name) || name === "changes") {
      problems.push(`${where}: an axis name is lower-case letters, digits and "-", and "changes" is reserved`);
    }
    const attribute = def.attribute ?? `data-${name}`;
    if (!ATTRIBUTE.test(attribute)) problems.push(`${where}: attribute ${show(attribute)} must look like data-<name>`);

    const ids = Object.keys(isRecord(def.options) ? def.options : {});
    if (ids.length === 0) {
      problems.push(`${where}: no options`);
      continue;
    }
    for (const id of ids) if (!OPTION_ID.test(id)) problems.push(`${where}: option id ${show(id)} must be lower-case letters, digits and "-"`);
    const hasDefault = ids.includes(def.default);
    if (!hasDefault) problems.push(`${where}: the default ${show(def.default)} is not one of its options`);

    const reference = def.options[hasDefault ? def.default : ids[0]!]!;
    const names = Object.keys(isRecord(reference.tokens) ? reference.tokens : {});
    const options = new Map<string, CompiledOption>();
    for (const id of ids) {
      const option = def.options[id]!;
      const at = `${where}, option "${id}"`;
      if (!isRecord(option.tokens)) {
        problems.push(`${at}: tokens must be an object`);
        continue;
      }
      const tokens = usable(option.tokens, at, problems);
      const missing = names.filter((n) => !(n in option.tokens));
      const extra = Object.keys(option.tokens).filter((n) => !names.includes(n));
      if (missing.length) problems.push(`${at}: missing ${missing.join(", ")}; every option on an axis sets the same tokens`);
      if (extra.length) problems.push(`${at}: sets ${extra.join(", ")}, which the default option does not`);
      const lang: (readonly [string, Tokens])[] = [];
      for (const [tag, values] of Object.entries(isRecord(option.lang) ? option.lang : {})) {
        if (!LANG.test(tag)) problems.push(`${at}: ${show(tag)} is not a language tag`);
        if (!isRecord(values)) {
          problems.push(`${at}: lang.${tag} must be an object`);
          continue;
        }
        const own = Object.keys(values).filter((n) => !names.includes(n));
        if (own.length) problems.push(`${at}: lang.${tag} sets ${own.join(", ")}, which the option itself does not`);
        lang.push([tag, usable(values, `${at}, lang.${tag}`, problems)]);
      }
      options.set(id, Object.freeze({ tokens, lang: Object.freeze(lang) }));
    }

    const derive = typeof def.derive === "function" ? (def.derive as (tokens: Tokens) => Tokens) : undefined;
    const derivedHere = new Set<string>();
    if (derive) {
      for (const [id, option] of options) {
        let out: unknown;
        try {
          out = derive(option.tokens);
        } catch (error) {
          problems.push(`${where}, option "${id}": derive threw ${(error as Error)?.message ?? show(error)}`);
          continue;
        }
        if (!isRecord(out)) {
          problems.push(`${where}, option "${id}": derive must return an object of tokens`);
          continue;
        }
        usable(out, `${where}, option "${id}", derived`, problems);
        for (const n of Object.keys(out)) {
          if (names.includes(n)) problems.push(`${where}: derive sets ${n}, which is already a token`);
          derivedHere.add(n);
        }
      }
    }

    const floor = def.contrast?.floor ?? 4.5;
    if (typeof floor !== "number" || !(floor >= 1 && floor <= 21)) problems.push(`${where}: contrast floor ${show(floor)} must be between 1 and 21`);
    const pairs = (def.contrast?.pairs ?? []).map(([text, background]) => [String(text), String(background)] as const);
    for (const [text, background] of pairs) {
      for (const n of [text, background]) {
        if (!names.includes(n)) problems.push(`${where}: contrast pair ${text} on ${background} names ${n}, which is not a token`);
      }
    }
    for (const [id, option] of options) {
      for (const [text, background] of pairs) {
        const [fg, bg] = [option.tokens[text], option.tokens[background]];
        if (fg === undefined || bg === undefined) continue;
        if (!isHex(fg) || !isHex(bg)) {
          problems.push(`${where}, option "${id}": contrast pair ${text} on ${background} needs #RRGGBB colours, got ${show(fg)} and ${show(bg)}`);
          continue;
        }
        const ratio = contrast(fg, bg);
        if (ratio < floor) {
          problems.push(`${where}, option "${id}": ${text} on ${background} is ${ratio.toFixed(2)}:1, below the ${floor}:1 contrast floor`);
        }
      }
    }

    const colors = new Set(names.filter((n) => [...options.values()].every((o) => isHex(o.tokens[n]))));
    for (const n of [...names, ...derivedHere]) {
      const other = owner.get(n);
      if (other !== undefined && other !== name) problems.push(`token ${n} is set by both axis "${other}" and axis "${name}"`);
      else owner.set(n, name);
    }
    for (const n of derivedHere) derived.add(n);

    compiled.push({
      name,
      ids,
      default: def.default,
      attribute,
      storageKey: `${keyPrefix}preview-${name}`,
      options,
      derive,
      pairs,
      floor,
      colors,
    });
  }

  if (problems.length) throw new ThemeError("The theme can't be defined", problems);

  const withDerived = (a: CompiledAxis, tokens: Tokens): Tokens => (a.derive ? { ...tokens, ...a.derive(tokens) } : tokens);
  const optionOf = (a: CompiledAxis, choice: Choice<A>) => a.options.get((choice as Record<string, unknown>)[a.name] as string)!;
  const effective = (a: CompiledAxis, choice: Choice<A>): Tokens => {
    const changed = Object.entries(choice.changes).filter(([token]) => a.colors.has(token));
    const { tokens } = optionOf(a, choice);
    return changed.length ? { ...tokens, ...Object.fromEntries(changed) } : tokens;
  };

  const inspect = (saved: unknown) => {
    const issues: string[] = [];
    if (saved !== undefined && saved !== null && !isRecord(saved)) issues.push(`the saved choice is ${show(saved)}, not an object; using the defaults`);
    const raw = isRecord(saved) ? saved : {};
    const choice: Record<string, unknown> = {};
    for (const a of compiled) {
      const value = raw[a.name];
      if (value === undefined) choice[a.name] = a.default;
      else if (typeof value === "string" && a.ids.includes(value)) choice[a.name] = value;
      else {
        choice[a.name] = a.default;
        issues.push(`${a.name}: ${show(value)} is not an option; using "${a.default}"`);
      }
    }
    for (const key of Object.keys(raw)) {
      if (key !== "changes" && !compiled.some((a) => a.name === key)) issues.push(`${key}: not an axis of this theme; ignored`);
    }
    const changes: Record<string, string> = {};
    if (raw.changes !== undefined) {
      if (!isRecord(raw.changes)) issues.push(`changes: ${show(raw.changes)} is not an object of colours; ignored`);
      else {
        for (const [token, value] of Object.entries(raw.changes)) {
          const a = compiled.find((x) => x.name === owner.get(token));
          if (derived.has(token)) issues.push(`changes.${token}: computed from other tokens, so it follows them; ignored`);
          else if (!a) issues.push(`changes.${token}: not a token of this theme; ignored`);
          else if (!a.colors.has(token)) issues.push(`changes.${token}: only colours can be changed; ignored`);
          else if (!isHex(value)) issues.push(`changes.${token}: ${show(value)} is not a #RRGGBB colour; ignored`);
          else changes[token] = value;
        }
      }
    }
    choice.changes = Object.freeze(changes);
    return { choice: Object.freeze(choice) as unknown as Choice<A>, issues };
  };

  const unreadable = (choice: Choice<A>): string[] => {
    const out: string[] = [];
    for (const a of compiled) {
      if (a.pairs.length === 0 || !Object.keys(choice.changes).some((token) => a.colors.has(token))) continue;
      const tokens = effective(a, choice);
      for (const [text, background] of a.pairs) {
        const ratio = contrast(String(tokens[text]), String(tokens[background]));
        if (ratio < a.floor) {
          const id = (choice as Record<string, unknown>)[a.name];
          out.push(`${a.name} "${id}" with the saved changes: ${text} on ${background} is ${ratio.toFixed(2)}:1, below the ${a.floor}:1 contrast floor`);
        }
      }
    }
    return out;
  };

  // Every option under its attribute. It doesn't depend on the saved choice, so it is built once.
  const scoped = compiled
    .flatMap((a) =>
      a.ids.flatMap((id) => {
        const option = a.options.get(id)!;
        const selector = `[${a.attribute}="${id}"]`;
        return [
          `${selector}{${declarations(withDerived(a, option.tokens))}}`,
          ...option.lang.map(([tag, tokens]) => `${selector}:lang(${tag}){${declarations(tokens)}}`),
        ];
      }),
    )
    .join("\n");

  const script = previewScript(
    compiled.map((a) => ({ param: a.name, attribute: a.attribute, storageKey: a.storageKey, ids: a.ids })),
  );

  const axes = Object.freeze(
    Object.fromEntries(
      compiled.map((a) => [
        a.name,
        Object.freeze({ ids: Object.freeze([...a.ids]), default: a.default, attribute: a.attribute, param: a.name, storageKey: a.storageKey }),
      ]),
    ),
  ) as Theme<A>["axes"];

  return Object.freeze({
    axes,
    resolve: (saved: unknown) => inspect(saved).choice,
    problems(saved: unknown) {
      const { choice, issues } = inspect(saved);
      return [...issues, ...unreadable(choice)];
    },
    store(selection: Saved<A>) {
      const { choice, issues } = inspect(selection);
      const all = [...issues, ...unreadable(choice)];
      if (all.length) throw new ThemeError("The theme choice can't be saved", all);
      const out: Record<string, unknown> = {};
      for (const a of compiled) out[a.name] = (choice as Record<string, unknown>)[a.name];
      const changes: Record<string, string> = {};
      for (const [token, value] of Object.entries(choice.changes)) {
        const a = compiled.find((x) => x.colors.has(token))!;
        if (value.toLowerCase() !== String(optionOf(a, choice).tokens[token]).toLowerCase()) changes[token] = value;
      }
      if (Object.keys(changes).length) out.changes = changes;
      return out as Saved<A>;
    },
    css(saved: Saved<A> | Choice<A> = {} as Saved<A>) {
      const { choice } = inspect(saved);
      const failures = unreadable(choice);
      if (failures.length) throw new ThemeError("The saved theme makes text unreadable", failures);
      const root = compiled.map((a) => declarations(withDerived(a, effective(a, choice)))).filter(Boolean).join(";");
      const rules = [`:root{${root}}`];
      const tags: string[] = [];
      for (const a of compiled) for (const [tag] of optionOf(a, choice).lang) if (!tags.includes(tag)) tags.push(tag);
      for (const tag of tags) {
        const body = compiled
          .map((a) => optionOf(a, choice).lang.find(([t]) => t === tag)?.[1])
          .filter((tokens): tokens is Tokens => tokens !== undefined)
          .map(declarations)
          .join(";");
        rules.push(`:root:lang(${tag}){${body}}`);
      }
      return `${rules.join("\n")}\n${scoped}`;
    },
    tailwind(extra: { readonly [token: string]: string } = {}) {
      const lines = compiled.flatMap((a) => [...a.colors].map((t) => `  --color-${kebab(t)}: var(--${kebab(t)});`));
      const bad: string[] = [];
      for (const [token, variable] of Object.entries(extra)) {
        if (!owner.has(token)) bad.push(`${token}: not a token of this theme`);
        else if (!CSS_VAR.test(variable)) bad.push(`${token}: ${show(variable)} is not a variable name like --font-display`);
        else lines.push(`  ${variable}: var(--${kebab(token)});`);
      }
      if (bad.length) throw new ThemeError("The Tailwind mapping can't be built", bad);
      return `@theme inline {\n${lines.join("\n")}\n}\n`;
    },
    previewScript: () => script,
  });
}
