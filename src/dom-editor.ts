/** Placeholder until the browser host lands (text input, step 3). */
import { noEditor, type EditorHost } from "./editor";
export function domEditorHost(_canvas: HTMLCanvasElement): EditorHost { return noEditor; }
