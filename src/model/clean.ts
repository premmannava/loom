/**
 * Turns a model's raw streamed text into Loom lines, chunk by chunk:
 *
 * - drops thinking (`<think>…</think>`, as Qwen3 and DeepSeek R1 write it),
 * - drops code fences (```), which models add out of habit,
 * - drops chatter before the spec starts ("Here is your interface:"),
 * - joins a state value spread over several lines back into one line. Loom
 *   needs each value on one line (so a stream can render line by line), but
 *   models often lay out long lists like JSON, one item per line.
 *
 * It works on whole lines, so a tag or fence split across chunks is still
 * caught. A reasoning model may also start thinking without an opening tag
 * and only close it (`…</think>`); then everything passed on so far was
 * thinking, and the filter reports a reset so the caller can start over.
 */

export interface FilterOutput {
  /** Loom text to pass on (complete lines, each ending in a newline). */
  text: string;
  /** True when earlier output turned out to be thinking and must be thrown away. */
  reset: boolean;
}

import { openBrackets } from "../parser";

const FENCE = /^\s*```/;

/** A multi-line state value longer than this is passed on as it is, for the parser to report. */
const MAX_JOINED_LINES = 300;


export class SpecFilter {
  private partial = "";
  private thinking = false;
  private started = false;
  /** Lines of a state value still being joined, and how many brackets they leave open. */
  private joining: string[] = [];
  private depth = 0;
  /** Characters of thinking seen, for reporting. */
  thinkingChars = 0;

  /**
   * @param looksLikeLoom decides whether a line can start the spec, so prose
   *   before it is dropped. Once the spec has started, every line is kept.
   */
  constructor(private looksLikeLoom: (line: string) => boolean) {}

  push(chunk: string): FilterOutput {
    this.partial += chunk;
    const cut = this.partial.lastIndexOf("\n");
    if (cut < 0) return { text: "", reset: false };
    const complete = this.partial.slice(0, cut + 1);
    this.partial = this.partial.slice(cut + 1);
    return this.lines(complete.split("\n").slice(0, -1));
  }

  /** Call when the stream ends: the last line may have no newline. */
  end(): FilterOutput {
    const rest = this.partial;
    this.partial = "";
    const out = rest ? this.lines([rest]) : { text: "", reset: false };
    return { text: out.text + this.flushJoin(), reset: out.reset };
  }

  private flushJoin(): string {
    if (!this.joining.length) return "";
    const lines = this.joining;
    this.joining = [];
    // Unbalanced to the end, or too long: pass the lines on unchanged.
    return lines.map((l) => l + "\n").join("");
  }

  private lines(lines: string[]): FilterOutput {
    let out = "";
    let reset = false;
    for (let line of lines) {
      line = line.replace(/\r$/, "");
      // Thinking can open and close anywhere on a line; keep what's outside it.
      for (;;) {
        if (this.thinking) {
          const close = line.indexOf("</think>");
          if (close < 0) { this.thinkingChars += line.length + 1; line = ""; break; }
          this.thinkingChars += close;
          this.thinking = false;
          line = line.slice(close + "</think>".length);
          continue;
        }
        const open = line.indexOf("<think>");
        const orphanClose = line.indexOf("</think>");
        if (orphanClose >= 0 && (open < 0 || orphanClose < open)) {
          // Thinking began without an opening tag: drop everything so far.
          reset = reset || this.started || out.length > 0;
          this.thinkingChars += out.length + orphanClose;
          out = "";
          this.started = false;
          this.joining = [];
          line = line.slice(orphanClose + "</think>".length);
          continue;
        }
        if (open < 0) break;
        const before = line.slice(0, open);
        this.thinking = true;
        line = line.slice(open + "<think>".length);
        if (before.trim()) out += this.keep(before);
      }
      if (!line.trim() && !this.started) continue;
      out += this.keep(line);
    }
    return { text: out, reset };
  }

  private keep(line: string): string {
    if (FENCE.test(line)) return "";
    if (!this.started) {
      if (!this.looksLikeLoom(line)) return "";
      this.started = true;
    }
    if (this.joining.length) {
      this.joining.push(line);
      this.depth = openBrackets(line, this.depth);
      if (this.depth <= 0) {
        const joined = this.joining.map((l, i) => (i ? l.trim() : l.trimEnd())).join(" ");
        this.joining = [];
        return joined + "\n";
      }
      return this.joining.length >= MAX_JOINED_LINES ? this.flushJoin() : "";
    }
    if (/^state\s/.test(line)) {
      const depth = openBrackets(line);
      if (depth > 0) {
        this.joining = [line];
        this.depth = depth;
        return "";
      }
    }
    return line + "\n";
  }
}

/** A line that could start a spec: state, a comment, or a known element name. */
export function loomLineTest(isElement: (name: string) => boolean): (line: string) => boolean {
  return (line) => {
    const t = line.trim();
    if (!t) return false;
    if (t.startsWith("#")) return true;
    const word = /^[A-Za-z][\w-]*/.exec(t)?.[0];
    if (!word) return false;
    if (word === "state") return /^state(\s|$)/.test(t);
    // An element name alone, or followed by a space ("card", "text \"Hi\""), not prose ("Here's").
    return isElement(word) && (t.length === word.length || /\s/.test(t[word.length]!));
  };
}
