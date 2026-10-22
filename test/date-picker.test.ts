import { afterEach, describe, expect, it, vi } from "vitest";
import { coreComponents } from "../src/components";
import { addDays, addMonths, daysInMonth, displayDate, formatDate, fromDays, isLeapYear, localToday, parseDate, toDays, weekday } from "../src/dates";
import { parse } from "../src/parser";
import { Registry } from "../src/registry";
import { render, type Rendered } from "../src/testing";
import { darkTheme, lightTheme } from "../src/theme";

const registry = new Registry(coreComponents);
const TODAY = "2026-10-21";
const spec = (props = "", value = "") => `state due="${value}" n=0\ndate-picker "Due date" bind=due ${props} on=inc:n\nbutton "Below" on=inc:clicks\n`;
const open = (ui: Rendered) => ui.press("date-picker");
const days = (ui: Rendered) => ui.popup!.regions.map((r) => String(r.detail)).filter((d) => d.startsWith("day:")).map((d) => d.slice(4));
const pressPopup = (ui: Rendered, detail: string) => {
  const r = ui.popup?.regions.find((h) => h.detail === detail);
  expect(r, `the calendar has ${detail}`).toBeDefined();
  ui.click(r!.box.x + r!.box.w / 2, r!.box.y + r!.box.h / 2);
};

describe("calendar dates", () => {
  it("knows leap years", () => {
    expect([2024, 2000, 2400].map(isLeapYear)).toEqual([true, true, true]);
    expect([2023, 1900, 2100].map(isLeapYear)).toEqual([false, false, false]);
    expect(daysInMonth(2024, 2)).toBe(29);
    expect(daysInMonth(2026, 2)).toBe(28);
    expect(parseDate("2024-02-29")).toEqual({ y: 2024, m: 2, d: 29 });
    expect(parseDate("2023-02-29")).toBeNull();
    expect(parseDate("1900-02-29")).toBeNull();
    expect(parseDate("2000-02-29")).not.toBeNull();
  });

  it("only reads real YYYY-MM-DD dates", () => {
    for (const bad of ["2026-02-30", "2026-04-31", "2026-13-01", "2026-00-10", "2026-01-00", "2026-2-3", "26-01-01", "2026-01-01T00:00", " 2026-01-01", "0000-01-01", "", "today", 20260101, null, undefined, true]) {
      expect(parseDate(bad), String(bad)).toBeNull();
    }
    expect(parseDate("0001-01-01")).toEqual({ y: 1, m: 1, d: 1 });
    expect(parseDate("9999-12-31")).toEqual({ y: 9999, m: 12, d: 31 });
  });

  it("counts days without Date, so round trips never shift", () => {
    expect(toDays({ y: 1970, m: 1, d: 1 })).toBe(0);
    expect(fromDays(0)).toEqual({ y: 1970, m: 1, d: 1 });
    expect(weekday({ y: 2026, m: 10, d: 21 })).toBe(3); // a Wednesday
    expect(weekday({ y: 2000, m: 1, d: 1 })).toBe(6); // a Saturday
    // Every day from 1899 to 2101, and the ends of the range: text → days → text is the same text.
    for (let n = toDays({ y: 1899, m: 1, d: 1 }); n <= toDays({ y: 2101, m: 12, d: 31 }); n++) {
      const c = fromDays(n);
      expect(toDays(c)).toBe(n);
      const iso = formatDate(c);
      expect(formatDate(parseDate(iso)!)).toBe(iso);
    }
    for (const iso of ["0001-01-01", "9999-12-31", "1582-10-15"]) expect(formatDate(fromDays(toDays(parseDate(iso)!)))).toBe(iso);
  });

  it("steps across month and year ends, keeping to the month's last day", () => {
    expect(formatDate(addDays({ y: 2026, m: 12, d: 31 }, 1))).toBe("2027-01-01");
    expect(formatDate(addDays({ y: 2024, m: 3, d: 1 }, -1))).toBe("2024-02-29");
    expect(formatDate(addMonths({ y: 2027, m: 1, d: 31 }, 1))).toBe("2027-02-28");
    expect(formatDate(addMonths({ y: 2028, m: 1, d: 31 }, 1))).toBe("2028-02-29");
    expect(formatDate(addMonths({ y: 2026, m: 12, d: 15 }, 1))).toBe("2027-01-15");
    expect(formatDate(addMonths({ y: 2026, m: 1, d: 15 }, -1))).toBe("2025-12-15");
  });

  it("reads today from the device's local calendar day, not UTC", () => {
    vi.useFakeTimers();
    // Late evening, local time: in UTC it may already be tomorrow.
    vi.setSystemTime(new Date(2026, 9, 21, 23, 30));
    expect(localToday()).toBe("2026-10-21");
    vi.setSystemTime(new Date(2026, 9, 22, 0, 15));
    expect(localToday()).toBe("2026-10-22");
  });
  afterEach(() => { vi.useRealTimers(); });

  it("shows dates in US English", () => {
    expect(displayDate({ y: 2026, m: 3, d: 3 })).toBe("Tue, Mar 3, 2026");
  });
});

describe("date-picker specs", () => {
  it("parses its example and explains bad props", () => {
    expect(parse(spec(`min="2026-01-01" max="2027-12-31" required=true placeholder="When?"`), registry).diagnostics).toEqual([]);
    const msgs = (s: string) => parse(`state due=""\n${s}\n`, registry).diagnostics.map((d) => d.message);
    expect(msgs(`date-picker "Due"`)).toEqual([`"date-picker" needs bind=`]);
    expect(msgs(`date-picker bind=due required=maybe`)[0]).toMatch(/required should be true or false/);
    expect(msgs(`date-picker bind=due time=true`)[0]).toMatch(/"date-picker" has no prop "time"/);
  });

  it("shows the date, the placeholder, or that the value isn't a date", () => {
    expect(render(spec("", "2026-03-03"), { today: TODAY }).text()).toContain("Tue, Mar 3, 2026");
    expect(render(spec(`placeholder="When?"`), { today: TODAY }).text()).toContain("When?");
    const bad = render(spec("", "2026-02-30"), { today: TODAY });
    expect(bad.text()).toContain("Invalid date");
    expect(bad.warnings).toEqual([`date-picker on line 2: bind= holds "2026-02-30", which isn't a real date, so it shows "Invalid date". Dates are YYYY-MM-DD text, like "2026-03-14"`]);
    expect(bad.state.due).toBe("2026-02-30");
  });

  it("ignores bounds that aren't dates, or that are the wrong way round", () => {
    const ui = render(spec(`min="2026-02-30" max="soon"`), { today: TODAY });
    expect(ui.warnings).toEqual([
      `date-picker on line 2: min="2026-02-30" isn't a real date, so it's ignored. Write it as YYYY-MM-DD, like min="2026-01-31"`,
      `date-picker on line 2: max="soon" isn't a real date, so it's ignored. Write it as YYYY-MM-DD, like max="2026-01-31"`,
    ]);
    const flipped = render(spec(`min="2027-01-01" max="2026-01-01"`), { today: TODAY });
    expect(flipped.warnings).toEqual(["date-picker on line 2: min (2027-01-01) is after max (2026-01-01), so neither is used"]);
    open(flipped);
    expect(days(flipped)).toHaveLength(31);
  });

  it("shows a date outside the limits, says so, and doesn't change it", () => {
    const ui = render(spec(`min="2026-11-01"`, "2026-10-05"), { today: TODAY });
    expect(ui.text()).toContain("Mon, Oct 5, 2026");
    expect(ui.warnings).toEqual(["date-picker on line 2: bind= holds 2026-10-05, which is outside min and max. It's shown, but can't be chosen again"]);
    expect(ui.state.due).toBe("2026-10-05");
  });
});

describe("opening the calendar", () => {
  it("opens on the chosen date's month, or on today's", () => {
    let ui = render(spec("", "2024-02-29"), { today: TODAY });
    open(ui);
    expect(ui.popup!.state).toEqual({ month: "2024-02-01", focus: "2024-02-29" });
    ui = render(spec(), { today: TODAY });
    open(ui);
    expect(ui.popup!.state).toEqual({ month: "2026-10-01", focus: TODAY });
  });

  it("starts inside the limits when today is outside them", () => {
    let ui = render(spec(`min="2027-03-10"`), { today: TODAY });
    open(ui);
    expect(ui.popup!.state.focus).toBe("2027-03-10");
    ui = render(spec(`max="2025-06-30"`), { today: TODAY });
    open(ui);
    expect(ui.popup!.state.focus).toBe("2025-06-30");
  });

  it("follows the today option", () => {
    const ui = render(spec(), { today: "2031-07-04" });
    open(ui);
    expect(ui.popup!.state.month).toBe("2031-07-01");
  });

  it("shows leap days and month lengths", () => {
    const ui = render(spec("", "2028-02-10"), { today: TODAY });
    open(ui);
    expect(days(ui)).toHaveLength(29);
    expect(days(ui).at(-1)).toBe("2028-02-29");
    pressPopup(ui, "next");
    expect(days(ui)).toHaveLength(31);
  });

  it("offers only the days within the inclusive limits, and stops paging at them", () => {
    const ui = render(spec(`min="2026-10-15" max="2026-11-05"`), { today: TODAY });
    open(ui);
    expect(days(ui)[0]).toBe("2026-10-15");
    expect(days(ui).at(-1)).toBe("2026-10-31");
    expect(ui.popup!.regions.some((r) => r.detail === "prev")).toBe(false);
    pressPopup(ui, "next");
    expect(days(ui)).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04", "2026-11-05"]);
    expect(ui.popup!.regions.some((r) => r.detail === "next")).toBe(false);
  });

  it("pages across a year end", () => {
    const ui = render(spec("", "2026-12-20"), { today: TODAY });
    open(ui);
    pressPopup(ui, "next");
    expect(ui.popup!.state.month).toBe("2027-01-01");
    expect(ui.text()).toContain("January 2027");
    pressPopup(ui, "prev");
    pressPopup(ui, "prev");
    expect(ui.popup!.state.month).toBe("2026-11-01");
  });

  it("stays within the screen and isn't the field's full width", () => {
    const wide = render(spec(), { today: TODAY, width: 1000 });
    open(wide);
    expect(wide.popup!.area!.w).toBeLessThanOrEqual(7 * 40 + 16);
    const near = render(`state due=""\nspacer size=500\ndate-picker bind=due\n`, { today: TODAY, viewport: { top: 0, bottom: 600 } });
    open(near);
    const field = near.hits.find((h) => h.box.node.type === "date-picker")!.box;
    const a = near.popup!.area!;
    expect(a.y + a.h).toBeLessThanOrEqual(field.y);
    const narrow = render(spec(), { today: TODAY, width: 280 });
    open(narrow);
    expect(narrow.popup!.area!.x + narrow.popup!.area!.w).toBeLessThanOrEqual(280);
  });
});

describe("choosing", () => {
  it("writes YYYY-MM-DD, closes, restores focus and runs on= once", () => {
    const ui = render(spec(), { today: TODAY });
    open(ui);
    pressPopup(ui, "day:2026-10-30");
    expect(ui.state).toMatchObject({ due: "2026-10-30", n: 1 });
    expect(ui.popup).toBeNull();
    expect(ui.focused?.type).toBe("date-picker");
    expect(ui.text()).toContain("Fri, Oct 30, 2026");
    // The same date again changes nothing, so on= doesn't run.
    open(ui);
    pressPopup(ui, "day:2026-10-30");
    expect(ui.state.n).toBe(1);
  });

  it("round-trips the date exactly", () => {
    for (const iso of ["2024-02-29", "2026-01-01", "2026-12-31", "2026-03-08", "2026-11-01"]) {
      const ui = render(spec("", iso), { today: TODAY });
      open(ui);
      pressPopup(ui, "next");
      pressPopup(ui, "prev");
      pressPopup(ui, `day:${iso}`);
      expect(ui.state.due).toBe(iso);
      expect(ui.state.n).toBe(0);
    }
  });

  it("chooses today with the Today button, only when today is allowed", () => {
    const ui = render(spec(), { today: TODAY });
    open(ui);
    pressPopup(ui, "today");
    expect(ui.state.due).toBe(TODAY);
    const outside = render(spec(`min="2027-01-01"`), { today: TODAY });
    open(outside);
    expect(outside.popup!.regions.some((r) => r.detail === "today")).toBe(false);
  });

  it("clears with the Clear button or Delete, unless a date is required", () => {
    const ui = render(spec("", "2026-10-30"), { today: TODAY });
    open(ui);
    pressPopup(ui, "clear");
    expect(ui.state).toMatchObject({ due: "", n: 1 });
    expect(ui.text()).toContain("Choose a date");
    const byKey = render(spec("", "2026-10-30"), { today: TODAY });
    byKey.tab();
    expect(byKey.focused?.type).toBe("date-picker");
    byKey.key("Delete");
    expect(byKey.state).toMatchObject({ due: "", n: 1 });
    const required = render(spec("required=true", "2026-10-30"), { today: TODAY });
    open(required);
    expect(required.popup!.regions.some((r) => r.detail === "clear")).toBe(false);
    required.key("Escape");
    required.key("Backspace");
    expect(required.state.due).toBe("2026-10-30");
  });

  it("keeps clicks from reaching what's under the calendar", () => {
    const ui = render(spec(), { today: TODAY });
    const button = ui.hits.find((h) => h.box.node.type === "button")!.box;
    open(ui);
    const a = ui.popup!.area!;
    expect(button.y).toBeLessThan(a.y + a.h);
    // A spot in the calendar that isn't a day: under it is the button.
    ui.click(a.x + a.w - 4, button.y + button.h / 2);
    expect(ui.state.clicks).toBeUndefined();
    // Outside the calendar: it closes, and the press goes no further.
    ui.click(button.x + button.w - 4, button.y + button.h / 2);
    expect(ui.popup).toBeNull();
    expect(ui.state.clicks).toBeUndefined();
  });
});

describe("the keyboard", () => {
  it("moves by day, week, month and to the week's ends, across months and years", () => {
    const ui = render(spec("", "2026-12-31"), { today: TODAY });
    ui.tab();
    ui.key("ArrowDown");
    expect(ui.popup!.state).toEqual({ month: "2026-12-01", focus: "2026-12-31" });
    ui.key("ArrowRight");
    expect(ui.popup!.state).toEqual({ month: "2027-01-01", focus: "2027-01-01" });
    ui.key("ArrowLeft");
    ui.key("ArrowUp");
    expect(ui.popup!.state.focus).toBe("2026-12-24");
    ui.key("ArrowDown");
    ui.key("PageDown");
    expect(ui.popup!.state.focus).toBe("2027-01-31");
    ui.key("PageDown");
    expect(ui.popup!.state.focus).toBe("2027-02-28");
    ui.key("Home");
    expect(weekday(parseDate(String(ui.popup!.state.focus))!)).toBe(0);
    ui.key("End");
    expect(weekday(parseDate(String(ui.popup!.state.focus))!)).toBe(6);
    ui.key("PageUp");
    ui.key("Enter");
    expect(ui.popup).toBeNull();
    expect(ui.state.due).toMatch(/^2027-0[12]-\d\d$/);
    expect(ui.focused?.type).toBe("date-picker");
  });

  it("keeps to the limits, and Escape changes nothing", () => {
    const ui = render(spec(`min="2026-10-20" max="2026-10-22"`), { today: TODAY });
    ui.tab();
    ui.key("ArrowDown");
    ui.key("ArrowRight");
    ui.key("ArrowRight");
    ui.key("ArrowRight");
    expect(ui.popup!.state.focus).toBe("2026-10-22");
    ui.key("PageUp");
    expect(ui.popup!.state.focus).toBe("2026-10-20");
    ui.key("Escape");
    expect(ui.popup).toBeNull();
    expect(ui.state.due).toBe("");
    expect(ui.focused?.type).toBe("date-picker");
    // Reopening starts afresh: the month and day it was on weren't kept anywhere.
    ui.key("ArrowDown");
    expect(ui.popup!.state.focus).toBe(TODAY);
  });
});

describe("inside each", () => {
  it("each copy writes its own item", () => {
    const ui = render(`state trips=[{name: "Denver", on: ""}, {name: "Austin", on: ""}]
each items=trips as=t
  date-picker "{t.name}" bind=t.on
`, { today: TODAY });
    expect(ui.diagnostics).toEqual([]);
    const second = ui.findAll("date-picker")[1]!.node.id;
    const field = ui.hits.find((h) => h.box.node.id === second)!.box;
    ui.click(field.x + 10, field.y + 10);
    pressPopup(ui, "day:2026-10-25");
    expect(JSON.parse(JSON.stringify(ui.state.trips))).toEqual([{ name: "Denver", on: "" }, { name: "Austin", on: "2026-10-25" }]);
  });
});

describe("themes", () => {
  it.each([["light", lightTheme], ["dark", darkTheme]] as const)("draws the calendar with %s theme colors", (_, theme) => {
    const ui = render(spec(`min="2026-10-03"`, "2026-10-14"), { today: TODAY, theme });
    open(ui);
    const c = theme.colors;
    const allowed = new Set(Object.values(c));
    for (const o of ui.drawOps) expect(allowed.has(o.op.startsWith("fill") ? o.fillStyle : o.strokeStyle), `${o.op}`).toBe(true);
    const text = (t: string) => ui.drawOps.filter((o) => o.op === "fillText" && o.args[0] === t).at(-1)!;
    expect(text("14").fillStyle).toBe(c.onAccent); // chosen
    expect(text("21").fillStyle).toBe(c.accent); // today
    expect(text("2").fillStyle).toBe(c.line); // before min
    expect(text("October 2026").fillStyle).toBe(c.ink);
  });
});

describe("the Request playground sample", () => {
  it("fills in the summary from state", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.request!.spec, { width: 375, today: TODAY });
    expect(ui.diagnostics).toEqual([]);
    expect(ui.warnings).toEqual([]);
    ui.press("select");
    ui.key("Enter");
    open(ui);
    pressPopup(ui, "day:2026-11-12");
    expect(ui.state).toMatchObject({ item: "laptop", needBy: "2026-11-12" });
    expect(ui.text()).toContain("Delivered by 2026-11-12");
    ui.press({ type: "button", text: "Send request" });
    expect(ui.emitted.at(-1)).toEqual({ name: "request", value: "laptop" });
  });
});
