import type { GuideOptions } from "../src/prompt";

/** Small enough for local models, with a complete example of connected state. */
export function playgroundGuide(imageHosts: readonly string[]): GuideOptions {
  return {
    imageHosts,
    mode: "compact",
    workedExamples: ["equipment", "calculator", "shopping"],
    notes: `Build the requested screen, not a copy of the example. Use only documented functions and props.
Declare editable values with state; computed values with derive name={expression}, one derive per line. Never bind a control to a derived value.
Props typed path take a bare writable state name (bind=selected), not a literal, object or {expression}. Initialize every writable name first.
bind= automatically updates its state when a control changes. Do not add on= just to copy its new value. There is no implicit value, event, or event.target variable.
For numeric quantities, amounts and percentages, use stepper or slider bound to numeric state. Keep units in quoted labels, not in state: percent=15, never percent="15%". Use money() only for display; keep calculations numeric. Use a positive minimum for a divisor such as people.
Actions are strings such as on="set:quantity:1"; do not wrap action syntax in expression braces or join actions with &&. Use semicolons.
Parent-child rule: list-item only goes inside a list. For a checklist with row controls, use each items=groceries as=item, then row with check and button. For a display-only list use list then indented list-item rows.
Do not invent JavaScript methods such as value.replace(), arrow functions, map(), now(), format() or addDays(). If dates need limits, use supplied YYYY-MM-DD dates; otherwise omit limits.
A selected record comes from find(list, 'id', selectedKey). Calculate totals from that record and quantity. An All filter must return the original list.
Before output, check required props, enum values, state declarations, and that every requested interaction has a binding. Output only the finished Loom spec.`,
  };
}
