/** A value that can live in Loom state or result from an expression. */
export type Value = number | string | boolean | null;

/** One element in the spec tree, created from one line of the spec. */
export interface LoomNode {
  /** Stable identity across re-parses: `${line}:${type}`. */
  id: string;
  type: string;
  /** The positional quoted text, e.g. the label in `button "Save"`. */
  text?: string;
  /** Raw prop strings. Components interpret them through a PropReader. */
  props: Record<string, string>;
  children: LoomNode[];
  /** 1-based line number in the spec. */
  line: number;
  indent: number;
}

export type Severity = "error" | "warning";

export interface Diagnostic {
  line: number;
  severity: Severity;
  message: string;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The result of layout for one node. */
export interface Box extends Rect {
  node: LoomNode;
  children: Box[];
  /** Component-private layout results (wrapped lines, scale factors...). */
  data?: Record<string, unknown>;
}

/** A clickable or focusable region registered during paint. */
export interface HitRegion {
  box: Box;
  /** Extra detail for components with sub-regions (e.g. which country on a map). */
  detail?: unknown;
  focusable: boolean;
}

/** What the pointer or keyboard focus is currently on. */
export interface HitTarget {
  node: LoomNode;
  box: Box;
  detail?: unknown;
}
