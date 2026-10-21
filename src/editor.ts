/**
 * Typing. Loom draws text fields on the canvas, but while one is being
 * edited the engine asks an editor host to put a real text box exactly over
 * it, so the browser does what it's good at: typing, selection, copy and
 * paste, undo, input methods for other languages, autocorrect, password
 * managers and phone keyboards (CLAUDE.md rule 7 allows this one DOM use).
 *
 * The engine only talks to the EditorHost interface. The browser host
 * (domEditorHost) makes an <input>; loom-ui/testing uses a fake one, so
 * typing is tested in Node like everything else.
 */
import type { Rect } from "./types";

export const INPUT_KINDS = ["text", "email", "number", "password", "search"] as const;
export type InputKind = (typeof INPUT_KINDS)[number];

/** What a field looks like and holds, for the text box placed over it. */
export interface EditorSpec {
  /** Where the text sits, in canvas CSS pixels. */
  rect: Rect;
  /** A canvas font string; the text box uses the same, so the text doesn't jump. */
  font: string;
  color: string;
  /** Caret and selection color. */
  accent: string;
  kind: InputKind;
  value: string;
  placeholder: string;
  /** Read by screen readers. */
  label: string;
  /** Longest value in characters. */
  max: number;
}

/** What the text box reports back to the engine. */
export interface EditorEvents {
  /** The value changed (every keystroke). */
  input(value: string): void;
  /** A key was pressed. Returns true when the engine handled it (Enter, Tab, Escape). */
  key(key: string, shift: boolean): boolean;
  /** Focus left the text box. */
  blur(): void;
}

export interface EditorHost {
  /** Show a focused text box for a field. Called during the press, so phones open their keyboard. */
  open(spec: EditorSpec, events: EditorEvents): void;
  /** The field moved, or its value changed from outside (an action cleared it). */
  update(spec: EditorSpec): void;
  /** Remove the text box. Must not report blur. */
  close(): void;
}

/** A host that can't edit, for environments with no DOM and no fake. */
export const noEditor: EditorHost = { open() {}, update() {}, close() {} };
