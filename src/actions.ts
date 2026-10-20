/**
 * Actions are what interactive components do when pressed:
 *
 *   inc:key[:by]        add `by` (default 1)
 *   dec:key[:by]        subtract `by` (default 1), never below 0
 *   toggle:key          flip true/false
 *   set:key:value       set a literal or {expression}
 *   emit:name[:value]   send an event to the host app (e.g. to ask the model)
 *
 * Several actions can run in order, separated by `;`.
 */
import { checkSyntax, evaluate, type Scope } from "./expr";
import type { Value } from "./types";

export type Action =
  | { op: "inc" | "dec"; key: string; by: string }
  | { op: "toggle"; key: string }
  | { op: "set"; key: string; value: string }
  | { op: "emit"; name: string; value?: string };

export const ACTION_OPS = ["inc", "dec", "toggle", "set", "emit"] as const;

/** Parse an action string. Returns the actions, or an error message. */
export function parseActions(src: string): { actions: Action[] } | { error: string } {
  const actions: Action[] = [];
  for (const raw of splitTopLevel(src, ";")) {
    const part = raw.trim();
    if (!part) continue;
    const first = part.indexOf(":");
    if (first < 0) return { error: `Action "${part}" needs a target, like inc:count` };
    const op = part.slice(0, first);
    const rest = part.slice(first + 1);
    const second = rest.indexOf(":");
    const key = second < 0 ? rest : rest.slice(0, second);
    const arg = second < 0 ? undefined : rest.slice(second + 1);
    if (!/^[A-Za-z_][\w]*$/.test(key)) return { error: `"${key}" is not a valid name in action "${part}"` };
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
}

export function runActions(actions: Action[], host: ActionHost): void {
  for (const a of actions) {
    switch (a.op) {
      case "inc":
      case "dec": {
        const cur = Number(host.scope(a.key) ?? 0) || 0;
        const by = Number(resolveArg(a.by, host.scope)) || 0;
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
    }
  }
}

function splitTopLevel(s: string, sep: string): string[] {
  const out: string[] = [];
  let depth = 0, buf = "";
  for (const c of s) {
    if (c === "{") depth++;
    if (c === "}") depth--;
    if (c === sep && depth === 0) { out.push(buf); buf = ""; } else buf += c;
  }
  out.push(buf);
  return out;
}
