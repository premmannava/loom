/** Measures text so layout can work without (or before) painting. */
export interface TextMeasurer {
  width(text: string, font: string): number;
}

/** Measures with a canvas context, caching results per font+text. */
export class CanvasMeasurer implements TextMeasurer {
  private cache = new Map<string, number>();
  constructor(private g: CanvasRenderingContext2D) {}

  width(text: string, font: string): number {
    const key = font + "\u0000" + text;
    let w = this.cache.get(key);
    if (w === undefined) {
      this.g.font = font;
      w = this.g.measureText(text).width;
      if (this.cache.size > 5000) this.cache.clear();
      this.cache.set(key, w);
    }
    return w;
  }

  /** Call when web fonts finish loading: cached widths are stale. */
  invalidate(): void {
    this.cache.clear();
  }
}

/** A fixed-advance measurer, for tests and headless layout. */
export class MonoMeasurer implements TextMeasurer {
  constructor(private advance = 0.55) {}
  width(text: string, font: string): number {
    const size = Number(/(\d+(?:\.\d+)?)px/.exec(font)?.[1] ?? 15);
    return text.length * size * this.advance;
  }
}

/** Greedy word wrap. Words longer than a line are broken by character. */
export function wrapText(text: string, maxWidth: number, font: string, m: TextMeasurer): string[] {
  const out: string[] = [];
  for (const paragraph of text.split("\n")) {
    let line = "";
    for (const word of paragraph.split(/\s+/).filter(Boolean)) {
      const candidate = line ? line + " " + word : word;
      if (m.width(candidate, font) <= maxWidth) { line = candidate; continue; }
      if (line) out.push(line);
      if (m.width(word, font) <= maxWidth) { line = word; continue; }
      let chunk = "";
      for (const ch of word) {
        if (chunk && m.width(chunk + ch, font) > maxWidth) { out.push(chunk); chunk = ""; }
        chunk += ch;
      }
      line = chunk;
    }
    out.push(line);
  }
  return out;
}

export function font(weight: number | string, size: number, family: string): string {
  return `${weight} ${size}px ${family}`;
}
