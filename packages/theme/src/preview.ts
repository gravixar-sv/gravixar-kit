export interface PreviewAxis {
  /** The query parameter, which is the axis name: `?preset=<id>`. */
  readonly param: string;
  readonly attribute: string;
  readonly storageKey: string;
  readonly ids: readonly string[];
}

/** Names the script already uses: the query, storage, the root element and the catch binding. */
const TAKEN = new Set(["q", "s", "d", "e"]);

/**
 * Each axis's variable names in the script: its initial, upper case for the id list and lower case for the
 * value (`P` and `p` for "preset"). If two initials clash, or one is a name the script already uses, every
 * axis is numbered instead (`V0` and `v0`). A two-axis theme therefore renders the same bytes as the script
 * this was extracted from, so adopting the package leaves a site's HTML unchanged.
 */
function variableNames(params: readonly string[]) {
  const initials = params.map((p) => p.charAt(0).toLowerCase());
  const clash = initials.some((c, i) => !/^[a-z]$/.test(c) || TAKEN.has(c) || initials.indexOf(c) !== i);
  return initials.map((c, i) => (clash ? { list: `V${i}`, value: `v${i}` } : { list: c.toUpperCase(), value: c }));
}

/**
 * An inline script for `<head>`, run before first paint. `?<axis>=<id>` starts a preview that lasts for the visit
 * (sessionStorage, this tab only) and `?preview=off` ends it. Only known ids are accepted. The preview sets the
 * option's attribute on `<html>`, where the theme CSS already has every option scoped. Storage that throws
 * (private modes, blocked cookies) leaves the page on the saved theme.
 */
export function previewScript(axes: readonly PreviewAxis[]): string {
  const names = variableNames(axes.map((a) => a.param));
  const json = JSON.stringify;
  const each = (render: (a: PreviewAxis, n: { list: string; value: string }) => string, separator: string) =>
    axes.map((a, i) => render(a, names[i]!)).join(separator);
  return (
    "(function(){try{var q=new URLSearchParams(location.search),s=sessionStorage,d=document.documentElement," +
    `${each((a, n) => `${n.list}=${json(a.ids)}`, ",")};` +
    `if(q.get("preview")==="off"){${each((a) => `s.removeItem(${json(a.storageKey)})`, ";")}}` +
    `var ${each((a, n) => `${n.value}=q.get(${json(a.param)})`, ",")};` +
    each((a, n) => `if(${n.list}.indexOf(${n.value})>-1)s.setItem(${json(a.storageKey)},${n.value});`, "") +
    each((a, n) => `${n.value}=s.getItem(${json(a.storageKey)});`, "") +
    each((a, n) => `if(${n.list}.indexOf(${n.value})>-1)d.setAttribute(${json(a.attribute)},${n.value})`, ";") +
    "}catch(e){}})()"
  );
}
