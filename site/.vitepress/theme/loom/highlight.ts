/**
 * A small syntax highlighter for SayShape source, for places that redraw the
 * source as it changes (the hero's streamed spec, the playground editor).
 * Static code blocks in the docs use the TextMate grammar in
 * .vitepress/loom.tmLanguage.json instead. It only colors text: it never
 * decides what is valid, which is the parser's job.
 */

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);
const span = (cls: string, text: string) => (text ? `<span class="${cls}">${esc(text)}</span>` : "");

/** Index just past a {…} expression starting at i (braces nest; quoted text inside is skipped). */
function endOfExpression(s: string, i: number): number {
  let depth = 0;
  for (let j = i; j < s.length; j++) {
    const c = s[j];
    if (c === "'" || c === '"') {
      const q = c;
      for (j++; j < s.length && s[j] !== q; j++) if (s[j] === "\\") j++;
    } else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) return j + 1;
  }
  return s.length;
}

/** A quoted string, with {expressions} inside it colored as expressions. */
function quoted(s: string, i: number): [string, number] {
  let out = "";
  let j = i + 1;
  let run = '"';
  while (j < s.length && s[j] !== '"') {
    if (s[j] === "\\") { run += s.slice(j, j + 2); j += 2; continue; }
    if (s[j] === "{") {
      out += span("tk-str", run);
      run = "";
      const end = endOfExpression(s, j);
      out += span("tk-expr", s.slice(j, end));
      j = end;
      continue;
    }
    run += s[j];
    j++;
  }
  if (j < s.length) { run += '"'; j++; }
  return [out + span("tk-str", run), j];
}

export function highlightLine(line: string): string {
  const indent = /^\s*/.exec(line)![0];
  const rest = line.slice(indent.length);
  if (rest.startsWith("#")) return esc(indent) + span("tk-com", rest);
  const head = /^[a-z][a-z0-9-]*/.exec(rest)?.[0] ?? "";
  let out = esc(indent);
  if (head === "state" || head === "derive") out += span("tk-kw", head);
  else if (head === "each" || head === "if") out += span("tk-flow", head);
  else out += span("tk-tag", head);
  let i = head.length;
  let plain = "";
  const flush = () => { out += esc(plain); plain = ""; };
  while (i < rest.length) {
    const c = rest[i]!;
    if (c === '"') { flush(); const [h, j] = quoted(rest, i); out += h; i = j; continue; }
    if (c === "{") { flush(); const end = endOfExpression(rest, i); out += span("tk-expr", rest.slice(i, end)); i = end; continue; }
    const prop = /^[A-Za-z_][\w-]*=/.exec(rest.slice(i));
    if (prop && (i === 0 || /\s/.test(rest[i - 1]!))) { flush(); out += span("tk-prop", prop[0]); i += prop[0].length; continue; }
    plain += c;
    i++;
  }
  flush();
  return out;
}

/** Highlighted HTML for a whole spec, one <span class="line"> per line. */
export function highlightSpec(spec: string): string {
  return spec.split("\n").map((l) => `<span class="line">${highlightLine(l)}</span>`).join("");
}
