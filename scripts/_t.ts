import { render } from "../src/testing";
import { samples } from "../playground/samples";
const ui = render(samples.directory!.spec, { width: 375 });
console.log(ui.diagnostics, ui.warnings, ui.text().slice(0, 6));
ui.press("select");
console.log(ui.popup?.area, ui.popup?.regions.map((r) => r.detail), ui.popup?.state);
ui.key("ArrowDown"); ui.key("ArrowDown"); ui.key("Enter");
console.log(ui.state.department, ui.popup, ui.emitted, ui.focused?.type);
console.log((ui.find("table").box!.data as any).rows.map((r: any) => r.key));
