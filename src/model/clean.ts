/**
 * Turns a model's raw streamed text into Loom lines, chunk by chunk:
 *
 * - drops thinking (`<think>…</think>`, as Qwen3 and DeepSeek R1 write it),
 * - drops code fences (```), which models add out of habit,
 * - drops chatter before the spec starts ("Here is your interface:").
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

const FENCE = /^\s*```/;

export class SpecFilter {
  private partial = "";
  private thinking = false;
  private started = false;
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
    return rest ? this.lines([rest]) : { text: "", reset: false };
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
