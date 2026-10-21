/**
 * Turns spec text into a tree of LoomNodes.
 *
 * The format is one element per line; indentation means "inside of":
 *
 *   state count=0
 *   card
 *     text "Clicked {count} times"
 *     button "Add one" on=inc:count
 *
 * The parser never throws. Problems become diagnostics with line numbers, and
 * the offending line (with anything nested under it) is skipped, so a model's
 * mistake costs one element, not the whole screen.
 */
import { parseActions } from "./actions";
import { COMMON_PROPS, type PropDef } from "./component";
import { checkSyntax, splitTemplate } from "./expr";
import { literal } from "./actions";
import type { Registry } from "./registry";
import type { Diagnostic, LoomNode, Value } from "./types";

/**
 * How deeply elements may nest. Real screens use under ten levels; the limit
 * stops a runaway or hostile spec from overflowing the engine's recursive
 * layout and paint (which fail somewhere past 500 levels).
 */
export const MAX_DEPTH = 100;

export interface ParseOptions {
  /** Ignore the last line if it has no trailing newline (it may still be streaming). */
  partial?: boolean;
  /** Props given to the invisible root column. */
  rootProps?: Record<string, string>;
}

export interface ParseResult {
  root: LoomNode;
  state: Array<{ key: string; value: Value; line: number }>;
  diagnostics: Diagnostic[];
  nodeCount: number;
  /** Number of complete lines consumed. */
  lines: number;
}

interface LineTokens {
  type: string;
  text?: string;
  props: Record<string, string>;
  problems: string[];
}

/** Tokenize one element line: `type "text" key=value key="quoted" key={expr}`. */
export function tokenizeLine(body: string): LineTokens {
  const out: LineTokens = { type: "", props: {}, problems: [] };
  let i = 0;
  const n = body.length;
  const skipWs = () => { while (i < n && /\s/.test(body[i]!)) i++; };

  const readQuoted = (): string | null => {
    const q = body[i]!;
    let j = i + 1, s = "";
    while (j < n && body[j] !== q) {
      if (body[j] === "\\" && j + 1 < n) { j++; s += body[j]; j++; continue; }
      s += body[j]; j++;
    }
    if (j >= n) return null;
    i = j + 1;
    return s;
  };

  const readBraced = (): string | null => {
    let depth = 0, j = i, quote = "";
    for (; j < n; j++) {
      const c = body[j]!;
      if (quote) { if (c === quote) quote = ""; continue; }
      if (c === "'" || c === '"') quote = c;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) break;
    }
    if (depth !== 0 || j >= n) return null;
    const s = body.slice(i, j + 1);
    i = j + 1;
    return s;
  };

  /** A bare value: runs to whitespace, but `{...}` inside it may contain spaces. */
  const readBare = (): string => {
    let s = "";
    while (i < n && !/\s/.test(body[i]!)) {
      if (body[i] === "{") {
        const b = readBraced();
        if (b === null) { s += body.slice(i); i = n; break; }
        s += b;
      } else { s += body[i]; i++; }
    }
    return s;
  };

  skipWs();
  const m = /^[A-Za-z][\w-]*/.exec(body.slice(i));
  if (!m) { out.problems.push(`Expected an element name at the start of the line`); return out; }
  out.type = m[0];
  i += m[0].length;

  while (i < n) {
    skipWs();
    if (i >= n) break;
    const c = body[i]!;
    if (c === '"' || c === "'") {
      const s = readQuoted();
      if (s === null) { out.problems.push(`Unclosed quote`); break; }
      if (out.text === undefined) out.text = s;
      else out.problems.push(`Extra text "${s}" ignored; an element takes one quoted text`);
      continue;
    }
    const key = /^[A-Za-z_][\w-]*(?==)/.exec(body.slice(i));
    if (key) {
      i += key[0].length + 1;
      let v: string | null;
      if (body[i] === '"' || body[i] === "'") v = readQuoted();
      else if (body[i] === "{") v = readBraced() ?? null;
      else v = readBare();
      if (v === null) { out.problems.push(`Unclosed value for "${key[0]}"`); break; }
      if (key[0] in out.props) out.problems.push(`"${key[0]}" is set twice; using the last one`);
      out.props[key[0]] = v;
      continue;
    }
    const word = readBare();
    out.problems.push(`Unexpected "${word}". Props look like name=value`);
  }
  return out;
}

function parseStateLine(body: string, line: number, diags: Diagnostic[]): Array<{ key: string; value: Value; line: number }> {
  const t = tokenizeLine("state " + body);
  for (const p of t.problems) diags.push({ line, severity: "warning", message: p });
  if (t.text !== undefined) diags.push({ line, severity: "warning", message: `state lines take name=value pairs, not quoted text` });
  return Object.entries(t.props).map(([key, raw]) => {
    if (/^\{.*\}$/.test(raw)) diags.push({ line, severity: "warning", message: `Initial state "${key}" must be a plain value, not an expression` });
    return { key, value: literal(raw), line };
  });
}

function checkProp(name: string, raw: string, def: PropDef, line: number, diags: Diagnostic[]): void {
  const warn = (message: string) => diags.push({ line, severity: "warning", message });
  const braced = /^\{(.*)\}$/s.exec(raw);
  if (braced) {
    const err = checkSyntax(braced[1]!);
    if (err) warn(`In ${name}: ${err}`);
    return;
  }
  switch (def.type) {
    case "number":
      if (isNaN(Number(raw))) warn(`${name} should be a number or {expression}, got "${raw}"`);
      break;
    case "boolean":
      if (raw !== "true" && raw !== "false") warn(`${name} should be true or false, got "${raw}"`);
      break;
    case "enum":
      if (def.values && !def.values.includes(raw)) warn(`${name} should be one of ${def.values.join(", ")}; got "${raw}"`);
      break;
    case "condition": {
      const err = checkSyntax(raw);
      if (err) warn(`In ${name}: ${err}`);
      break;
    }
    case "action": {
      const r = parseActions(raw);
      if ("error" in r) warn(r.error);
      break;
    }
    case "state":
      if (!/^[A-Za-z_]\w*$/.test(raw)) warn(`${name} should be a state name, got "${raw}"`);
      break;
    case "name":
      if (!/^[A-Za-z_]\w*$/.test(raw)) warn(`${name} should be a plain name (letters, digits and _), got "${raw}"`);
      break;
    case "string":
      for (const part of splitTemplate(raw)) {
        if ("expr" in part) { const err = checkSyntax(part.expr); if (err) warn(`In ${name}: ${err}`); }
      }
      break;
  }
}

export function parse(src: string, registry: Registry, opts: ParseOptions = {}): ParseResult {
  if (opts.partial) {
    const cut = src.lastIndexOf("\n");
    src = cut < 0 ? "" : src.slice(0, cut + 1);
  }
  const root: LoomNode = { id: "root", type: "column", props: { ...(opts.rootProps ?? {}) }, children: [], line: 0, indent: -1 };
  const diagnostics: Diagnostic[] = [];
  const state: ParseResult["state"] = [];
  const stack: LoomNode[] = [root];
  let nodeCount = 0;
  let skipDeeperThan: number | null = null;
  let last: LoomNode | null = null;

  const lines = src.split("\n");
  if (lines.at(-1) === "") lines.pop();

  lines.forEach((raw, idx) => {
    const lineNo = idx + 1;
    const expanded = raw.replace(/\t/g, "  ");
    const body = expanded.trim();
    if (!body || body.startsWith("#")) return;
    const indent = expanded.length - expanded.trimStart().length;

    if (skipDeeperThan !== null) {
      if (indent > skipDeeperThan) return;
      skipDeeperThan = null;
    }

    if (/^state(\s|$)/.test(body)) {
      if (indent > 0) diagnostics.push({ line: lineNo, severity: "warning", message: `state lines should not be indented` });
      state.push(...parseStateLine(body.slice(5), lineNo, diagnostics));
      return;
    }

    const tok = tokenizeLine(body);
    for (const p of tok.problems) diagnostics.push({ line: lineNo, severity: "warning", message: p });
    if (!tok.type) { skipDeeperThan = indent; return; }

    const def = registry.get(tok.type);
    if (!def) {
      diagnostics.push({ line: lineNo, severity: "error", message: `Unknown element "${tok.type}". It was skipped, along with anything inside it` });
      skipDeeperThan = indent;
      return;
    }

    if (last && indent > last.indent && !registry.get(last.type)?.children) {
      diagnostics.push({ line: lineNo, severity: "error", message: `"${tok.type}" is indented under "${last.type}" (line ${last.line}), which can't contain anything` });
      skipDeeperThan = indent;
      return;
    }
    while (stack.length > 1 && stack[stack.length - 1]!.indent >= indent) stack.pop();
    const parent = stack[stack.length - 1]!;
    // stack holds the root and every open container, so a new element sits at depth stack.length.
    if (stack.length > MAX_DEPTH) {
      diagnostics.push({ line: lineNo, severity: "error", message: `Nested too deeply (more than ${MAX_DEPTH} levels). This line and anything inside it were skipped; flatten the layout` });
      skipDeeperThan = indent;
      return;
    }
    const parentDef = parent === root ? registry.get("column") : registry.get(parent.type);
    const accepts = parentDef?.children;
    const parentName = parent === root ? "the top level" : `"${parent.type}" (line ${parent.line})`;
    if (!accepts || (accepts !== "any" && !accepts.includes(tok.type))) {
      diagnostics.push({ line: lineNo, severity: "error", message: `${parentName} can't contain "${tok.type}"` });
      skipDeeperThan = indent;
      return;
    }
    if (def.parents && !def.parents.includes(parent === root ? "root" : parent.type)) {
      diagnostics.push({ line: lineNo, severity: "error", message: `"${tok.type}" only goes inside ${def.parents.join(" or ")}` });
      skipDeeperThan = indent;
      return;
    }
    if (def.text?.required && tok.text === undefined) {
      diagnostics.push({ line: lineNo, severity: "warning", message: `"${tok.type}" needs quoted text, like ${tok.type} "Label"` });
    }
    if (tok.text !== undefined && !def.text) {
      diagnostics.push({ line: lineNo, severity: "warning", message: `"${tok.type}" doesn't take quoted text; it was ignored` });
    }
    if (tok.text?.includes("{")) {
      for (const part of splitTemplate(tok.text)) {
        if ("expr" in part) {
          const err = checkSyntax(part.expr);
          if (err) diagnostics.push({ line: lineNo, severity: "warning", message: `In text: ${err}` });
        }
      }
    }
    for (const [name, rawValue] of Object.entries(tok.props)) {
      const pdef = def.props[name] ?? COMMON_PROPS[name];
      if (!pdef) {
        const known = [...Object.keys(def.props), ...Object.keys(COMMON_PROPS)];
        diagnostics.push({ line: lineNo, severity: "warning", message: `"${tok.type}" has no prop "${name}". Known props: ${known.join(", ")}` });
        continue;
      }
      checkProp(name, rawValue, pdef, lineNo, diagnostics);
    }
    for (const [name, pdef] of Object.entries(def.props)) {
      if (pdef.required && !(name in tok.props)) diagnostics.push({ line: lineNo, severity: "warning", message: `"${tok.type}" needs ${name}=` });
    }

    const node: LoomNode = {
      id: `${lineNo}:${tok.type}`,
      type: tok.type,
      ...(tok.text !== undefined ? { text: tok.text } : {}),
      props: tok.props,
      children: [],
      line: lineNo,
      indent,
    };
    parent.children.push(node);
    last = node;
    nodeCount++;
    if (def.children) stack.push(node);
  });

  return { root, state, diagnostics, nodeCount, lines: lines.length };
}
