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
import { actionExpressions, parseActions } from "./actions";
import { COMMON_PROPS, type ComponentDef, type PropDef } from "./component";
import { looksLikeData, parseData } from "./data";
import { bareExpression, checkSyntax, identifiers, splitTemplate, wholeExpression } from "./expr";
import { actionTargets } from "./actions";
import { loopNames } from "./each";
import { PATH } from "./paths";
import { literal } from "./actions";
import type { Registry } from "./registry";
import type { Diagnostic, LoomNode, Value } from "./types";

/**
 * How deeply elements may nest. Real screens use under ten levels; the limit
 * stops a runaway or hostile spec from overflowing the engine's recursive
 * layout and paint (which fail somewhere past 500 levels).
 */
export const MAX_DEPTH = 100;

/** How many `[` and `{` are still open at the end of a line, outside quotes. */
export function openBrackets(line: string, depth = 0): number {
  let quote = "";
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
    if (c === "'" || c === '"') quote = c;
    else if (c === "[" || c === "{") depth++;
    else if (c === "]" || c === "}") depth--;
  }
  return depth;
}

/**
 * The condition block, written as a line holding only if={…}. It isn't a
 * registered component: it never reaches layout, which replaces it with its
 * children when the condition holds (see shownChildren in layout.ts).
 */
export const IF_BLOCK: ComponentDef = {
  type: "if",
  category: "layout",
  description: "Shows the lines indented under it only while its condition is true.",
  props: {},
  children: "any",
  layout(box) {
    box.h = 0;
  },
};

/** Elements with no box of their own, whose children belong to the container around them. */
export const TRANSPARENT = new Set(["each", "if"]);

function defOf(type: string, registry: Registry): ComponentDef | undefined {
  return type === "if" ? IF_BLOCK : registry.get(type);
}

export interface ParseOptions {
  /** Ignore the last line if it has no trailing newline (it may still be streaming). */
  partial?: boolean;
  /** Props given to the invisible root column. */
  rootProps?: Record<string, string>;
  /**
   * State the app supplies itself (loom.state.set), so reading it isn't
   * reported as an unknown name.
   */
  knownNames?: readonly string[];
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

  /** A `{…}` expression or a `[…]` list, which may hold spaces, quotes and each other. */
  const readGroup = (): string | null => {
    let depth = 0, j = i, quote = "";
    for (; j < n; j++) {
      const c = body[j]!;
      if (quote) { if (c === "\\") j++; else if (c === quote) quote = ""; continue; }
      if (c === "'" || c === '"') quote = c;
      else if (c === "{" || c === "[") depth++;
      else if ((c === "}" || c === "]") && --depth === 0) break;
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
      if (body[i] === "{" || body[i] === "[") {
        const b = readGroup();
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
      const start = i;
      let v: string | null;
      if (body[i] === '"' || body[i] === "'") v = readQuoted();
      else if (body[i] === "{" || body[i] === "[") v = readGroup() ?? null;
      else v = readBare();
      if (v === null) {
        const what = body[start] === "[" ? `its "[" isn't closed with "]"` : body[start] === "{" ? `its "{" isn't closed with "}"` : "its quote isn't closed";
        out.problems.push(`Unclosed value for "${key[0]}": ${what} on this line`);
        break;
      }
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
  const out: Array<{ key: string; value: Value; line: number }> = [];
  for (const [key, raw] of Object.entries(t.props)) {
    if (looksLikeData(raw)) {
      const r = parseData(raw);
      if ("error" in r) {
        diags.push({ line, severity: "warning", message: `State "${key}" wasn't set: ${r.error}. Write lists like [1, 2] and records like {name: "Ada", age: 36}, on one line` });
        continue;
      }
      out.push({ key, value: r.value, line });
      continue;
    }
    if (wholeExpression(raw) !== null) diags.push({ line, severity: "warning", message: `Initial state "${key}" must be a plain value, list or record, not an expression` });
    out.push({ key, value: literal(raw), line });
  }
  return out;
}

/** Every expression a line reads, for checking which names it uses. */
function expressionsOf(text: string | undefined, props: Record<string, string>, defs: Record<string, PropDef>): string[] {
  const out: string[] = [];
  const template = (s: string) => { for (const p of splitTemplate(s)) if ("expr" in p) out.push(p.expr); };
  if (text !== undefined) template(text);
  for (const [name, raw] of Object.entries(props)) {
    const def = defs[name] ?? COMMON_PROPS[name];
    if (!def) continue;
    const whole = wholeExpression(raw);
    if (def.type === "action") {
      const r = parseActions(raw);
      if ("actions" in r) out.push(...actionExpressions(r.actions));
    } else if (def.type === "state") {
      if (PATH.test(raw)) out.push(raw);
    } else if (whole !== null) out.push(whole);
    else if (def.type === "condition" || def.type === "expression") out.push(raw);
    else if (raw.includes("{")) template(raw);
  }
  return out;
}

function checkProp(name: string, raw: string, def: PropDef, line: number, diags: Diagnostic[]): void {
  const warn = (message: string) => diags.push({ line, severity: "warning", message });
  const whole = wholeExpression(raw);
  if (whole !== null) {
    const err = checkSyntax(whole);
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
    case "condition":
    case "expression": {
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
      if (!PATH.test(raw)) warn(`${name} should be a state name or a path like t.done, got "${raw}"`);
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
  // A state line whose list or record was left open: the lines after it are probably the rest of it.
  let openState: { line: number; reported: boolean } | null = null;
  // Names each line reads that it isn't inside the each for, checked once every each is known.
  const outsideUses: Array<{ line: number; names: string[] }> = [];
  const eaches: LoomNode[] = [];
  // State that bind= and actions write, so reading it before the first write isn't a mistake.
  const written = new Set<string>(opts.knownNames ?? []);

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
      openState = openBrackets(body) > 0 ? { line: lineNo, reported: false } : null;
      return;
    }

    // JSX or code where an element should be, like {items.map(…)} or <list-item>.
    if (/^[{<]/.test(body) && !openState) {
      diagnostics.push({ line: lineNo, severity: "warning", message: `Lines start with an element name. Loom has no JSX or code; to repeat elements for each item, use each items=list as=x and put the elements under it` });
      skipDeeperThan = indent;
      return;
    }

    // A line holding only if={…} is a condition block for the lines under it.
    // Any other prop on a line of its own was meant for an element.
    const loneProp = /^([A-Za-z_][\w-]*)=/.exec(body);
    let line = body;
    if (loneProp && !openState) {
      const block = tokenizeLine(`if ${body}`);
      if (loneProp[1] === "if" && !block.problems.length && block.text === undefined && Object.keys(block.props).join() === "if") {
        line = `if ${body}`;
      } else {
        const name = loneProp[1]!;
        diagnostics.push({ line: lineNo, severity: "warning", message: `A line can't start with ${name}=, so it was ignored. Put it on the element it's for, like list-item "Milk" ${name}=…` });
        return;
      }
    }

    const tok = tokenizeLine(line);
    if (!tok.type && openState) {
      if (!openState.reported) {
        openState.reported = true;
        diagnostics.push({ line: lineNo, severity: "warning", message: `This looks like more of the state value on line ${openState.line}, which was skipped. Write the whole value on line ${openState.line}, like state items=[{name: "A"}, {name: "B"}]` });
      }
      return;
    }
    openState = null;
    for (const p of tok.problems) diagnostics.push({ line: lineNo, severity: "warning", message: p });
    if (!tok.type) { skipDeeperThan = indent; return; }

    const def = defOf(tok.type, registry);
    if (!def) {
      diagnostics.push({ line: lineNo, severity: "error", message: `Unknown element "${tok.type}". It was skipped, along with anything inside it` });
      skipDeeperThan = indent;
      return;
    }

    if (last && indent > last.indent && !defOf(last.type, registry)?.children) {
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
    // each is transparent: what's inside it is checked against the container around it.
    let owner = stack.length - 1;
    while (owner > 0 && TRANSPARENT.has(stack[owner]!.type)) owner--;
    const container = stack[owner]!;
    const parentDef = container === root ? registry.get("column") : registry.get(container.type);
    const accepts = parentDef?.children;
    const parentName = container === root ? "the top level" : `"${container.type}" (line ${container.line})`;
    const fits = TRANSPARENT.has(tok.type) ? !!accepts : !!accepts && (accepts === "any" || accepts.includes(tok.type));
    if (!fits) {
      diagnostics.push({ line: lineNo, severity: "error", message: `${parentName} can't contain "${tok.type}"` });
      skipDeeperThan = indent;
      return;
    }
    if (def.parents && !def.parents.includes(container === root ? "root" : container.type)) {
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
    if (tok.type === "if" && tok.props.if === undefined) {
      diagnostics.push({ line: lineNo, severity: "warning", message: `An if block needs a condition, like if={count > 0}; the lines under it always show` });
    }
    if (tok.type === "each" && tok.props.as !== undefined && tok.props.as === tok.props.index) {
      diagnostics.push({ line: lineNo, severity: "warning", message: `each uses "${tok.props.as}" for both as= and index=; give them different names` });
    }

    const inScope = new Set<string>();
    for (const n of stack) if (n.type === "each") for (const name of loopNames(n)) inScope.add(name);
    // An each's own items= and key= are read outside and inside it respectively; only check items=.
    const exprs = tok.type === "each"
      ? (tok.props.items === undefined ? [] : [bareExpression(tok.props.items)])
      : expressionsOf(tok.text, tok.props, def.props);
    const names = [...new Set(exprs.flatMap(identifiers))].filter((n) => !inScope.has(n));
    if (names.length) outsideUses.push({ line: lineNo, names });
    for (const [name, raw] of Object.entries(tok.props)) {
      const pdef = def.props[name] ?? COMMON_PROPS[name];
      if (pdef?.type === "state" && PATH.test(raw)) written.add(raw.split(".")[0]!);
      if (pdef?.type === "action") { const r = parseActions(raw); if ("actions" in r) actionTargets(r.actions).forEach((t) => written.add(t)); }
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
    if (tok.type === "each") eaches.push(node);
    if (def.children) stack.push(node);
  });

  checkNames(outsideUses, eaches, new Set(state.map((s) => s.key)), written, diagnostics);
  // Stable sort keeps each line's diagnostics in the order they were found.
  diagnostics.sort((a, b) => a.line - b.line);
  return { root, state, diagnostics, nodeCount, lines: lines.length };
}

/** State the engine sets itself: the visible screen's name. */
const ENGINE_STATE = ["screen"];

/**
 * Warn about names a line reads that nothing defines, slips that would
 * otherwise just show a dash: a loop variable outside its each, or a word
 * meant as text but left unquoted ({done ? Yes : No}).
 */
function checkNames(uses: Array<{ line: number; names: string[] }>, eaches: LoomNode[], stateKeys: Set<string>, written: Set<string>, diags: Diagnostic[]): void {
  const defined = new Map<string, { each: LoomNode; prop: string }>();
  for (const e of eaches) {
    const as = e.props.as ?? "item";
    if (!defined.has(as)) defined.set(as, { each: e, prop: e.props.as ? `as=${as}` : `as=item, the default` });
    if (e.props.index && !defined.has(e.props.index)) defined.set(e.props.index, { each: e, prop: `index=${e.props.index}` });
  }
  for (const { line, names } of uses) {
    for (const name of names) {
      if (stateKeys.has(name) || ENGINE_STATE.includes(name)) continue;
      const d = defined.get(name);
      // Writing t.done outside its each doesn't make t exist there, so loop variables are checked first.
      if (!d && written.has(name)) continue;
      diags.push(d
        ? { line, severity: "warning", message: `"${name}" only exists inside the each on line ${d.each.line} (${d.prop}). Indent this line under it, or use a state name` }
        : { line, severity: "warning", message: `"${name}" isn't state or a loop variable, so it shows as nothing. To show it as text, quote it: '${name}'. To use state, declare it: state ${name}=…` });
    }
  }
}
