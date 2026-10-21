/**
 * Actions are what interactive components do when pressed:
 *
 *   inc:key[:by]        add `by` (default 1)
 *   dec:key[:by]        subtract `by` (default 1), never below 0
 *   toggle:key          flip true/false
 *   set:key:value       set a literal or {expression}
 *   emit:name[:value]   send an event to the host app (e.g. to ask the model)
 *   go:screen           show another screen, remembering this one
 *   back                return to the previous screen
 *   notify:'message'    show a short message; may include {expressions}
 *
 * Several actions can run in order, separated by `;`.
 */
import { checkSyntax, evaluate, interpolate, splitTemplate, type Scope } from "./expr";
import { toNumber } from "./data";
import type { Value } from "./types";

export type Action =
  | { op: "inc" | "dec"; key: string; by: string }
  | { op: "toggle"; key: string }
  | { op: "set"; key: string; value: string }
  | { op: "emit"; name: string; value?: string }
  | { op: "go"; screen: string }
  | { op: "back" }
  | { op: "notify"; message: string };

export const ACTION_OPS = ["inc", "dec", "toggle", "set", "emit", "go", "back", "notify"] as const;

/** How each action is written, for the model guide and error messages. */
export const ACTION_SYNTAX: Record<(typeof ACTION_OPS)[number], string> = {
  inc: "inc:key[:by]",
  dec: "dec:key[:by] (never below 0)",
  toggle: "toggle:key",
  set: "set:key:value or set:key:{expr}",
  emit: "emit:name[:value] tells the app what the user chose",
  go: "go:screen shows another screen (see screen)",
  back: "back returns to the previous screen",
  notify: "notify:'Saved {n} items' shows a short message",
};

const NAME = /^[A-Za-z_]\w*$/;

/** The message of a notify action: drop one pair of surrounding quotes. */
function unquote(s: string): string {
  const t = s.trim();
  return t.length >= 2 && (t[0] === "'" || t[0] === '"') && t.at(-1) === t[0] ? t.slice(1, -1) : t;
}

/** Parse an action string. Returns the actions, or an error message. */
export function parseActions(src: string): { actions: Action[] } | { error: string } {
  const actions: Action[] = [];
  for (const raw of splitTopLevel(src, ";")) {
    const part = raw.trim();
    if (!part) continue;
    if (part === "back") { actions.push({ op: "back" }); continue; }
    const first = part.indexOf(":");
    if (first < 0) return { error: `Action "${part}" needs a target, like inc:count` };
    const op = part.slice(0, first);
    const rest = part.slice(first + 1);

    if (op === "back") return { error: `back takes no target; write just back` };
    if (op === "notify") {
      const message = unquote(rest);
      if (!message.trim()) return { error: `notify needs a message, like notify:'Saved'` };
      for (const p of splitTemplate(message)) {
        if ("expr" in p) { const err = checkSyntax(p.expr); if (err) return { error: `In action "${part}": ${err}` }; }
      }
      actions.push({ op, message });
      continue;
    }

    const second = rest.indexOf(":");
    const key = second < 0 ? rest : rest.slice(0, second);
    const arg = second < 0 ? undefined : rest.slice(second + 1);
    if (!NAME.test(key)) return { error: `"${key}" is not a valid name in action "${part}"` };
    switch (op) {
      case "inc":
      case "dec":
        actions.push({ op, key, by: arg ?? "1" });
        break;
      case "toggle":
        actions.push({ op, key });
        break;
      case "set":
        if (arg === undefined) return { error: `set needs a value, like set:${key}:true` };
        actions.push({ op, key, value: arg });
        break;
      case "emit":
        actions.push(arg === undefined ? { op, name: key } : { op, name: key, value: arg });
        break;
      case "go":
        if (arg !== undefined) return { error: `go takes one screen name, like go:${key}` };
        actions.push({ op, screen: key });
        break;
      default:
        return { error: `Unknown action "${op}". Use ${ACTION_OPS.join(", ")}` };
    }
    const exprArg = arg && /^\{.*\}$/.test(arg) ? arg.slice(1, -1) : undefined;
    if (exprArg !== undefined) {
      const err = checkSyntax(exprArg);
      if (err) return { error: `In action "${part}": ${err}` };
    }
  }
  return { actions };
}

/** The expressions an action list reads: `{…}` arguments and the parts of notify messages. */
export function actionExpressions(actions: readonly Action[]): string[] {
  const out: string[] = [];
  const arg = (a: string | undefined) => { const m = a === undefined ? null : /^\{(.*)\}$/s.exec(a); if (m) out.push(m[1]!); };
  for (const a of actions) {
    if (a.op === "inc" || a.op === "dec") arg(a.by);
    else if (a.op === "set") arg(a.value);
    else if (a.op === "emit") arg(a.value);
    else if (a.op === "notify") for (const p of splitTemplate(a.message)) if ("expr" in p) out.push(p.expr);
  }
  return out;
}

/** Resolve an action argument: `{expr}` is evaluated, anything else is a literal. */
export function resolveArg(arg: string, scope: Scope): Value {
  const m = /^\{(.*)\}$/.exec(arg);
  if (m) {
    const r = evaluate(m[1]!, scope);
    return r.ok ? r.value : null;
  }
  return literal(arg);
}

export function literal(s: string): Value {
  if (s === "true") return true;
  if (s === "false") return false;
  if (s === "null") return null;
  if (s.trim() !== "" && !isNaN(Number(s))) return Number(s);
  return s;
}

export interface ActionHost {
  scope: Scope;
  set(key: string, value: Value): void;
  emit(name: string, value: Value | undefined): void;
  /** Show a screen. Hosts without screens can leave these out; the actions then do nothing. */
  go?(screen: string): void;
  back?(): void;
  /** Show a short message, already filled in from state. */
  notify?(message: string): void;
}

export function runActions(actions: Action[], host: ActionHost): void {
  for (const a of actions) {
    switch (a.op) {
      case "inc":
      case "dec": {
        // toNumber, not Number: a list or record here must count as 0, not crash.
        const cur = toNumber(host.scope(a.key) ?? 0) || 0;
        const by = toNumber(resolveArg(a.by, host.scope)) || 0;
        host.set(a.key, a.op === "inc" ? cur + by : Math.max(0, cur - by));
        break;
      }
      case "toggle":
        host.set(a.key, !host.scope(a.key));
        break;
      case "set":
        host.set(a.key, resolveArg(a.value, host.scope));
        break;
      case "emit":
        host.emit(a.name, a.value === undefined ? undefined : resolveArg(a.value, host.scope));
        break;
      case "go":
        host.go?.(a.screen);
        break;
      case "back":
        host.back?.();
        break;
      case "notify":
        host.notify?.(interpolate(a.message, host.scope));
        break;
    }
  }
}

/**
 * Split on `sep` outside braces and quoted arguments, so `notify:'a; b'` and
 * `{x ? 1 : 2}` stay whole. A quote only opens right after a colon, so an
 * apostrophe inside a value (`set:msg:it's`) is just a character.
 */
function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, quote = "", buf = "", prev = "";
  for (const c of s) {
    if (quote) { if (c === quote) quote = ""; }
    else if ((c === "'" || c === '"') && prev === ":") quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    if (c === sep && depth === 0 && !quote) { out.push(buf); buf = ""; } else buf += c;
    prev = c;
  }
  out.push(buf);
  return out;
}
