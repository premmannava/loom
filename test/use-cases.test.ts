/**
 * Screens from the 21-screen use-case run that needed list functions or
 * formatting, written as a model would with the guide. They must keep
 * working exactly as described.
 */
import { describe, expect, it } from "vitest";
import { render } from "../src/testing";
const screens: Record<string, [string, (ui: ReturnType<typeof render>) => void]> = {
  transactions: [`state cat="All" tx=[{name: "Whole Foods", cat: "Groceries", amount: -84.12}, {name: "Shell", cat: "Gas", amount: -46.5}, {name: "Payroll", cat: "Income", amount: 2400}, {name: "Trader Joe's", cat: "Groceries", amount: -38.9}]
card
  tabs bind=cat
    tab "All"
    tab "Groceries"
    tab "Gas"
  list
    each items=tx as=t
      list-item "{t.name}" detail="{t.cat}" trailing="{money(t.amount)}" if={cat == 'All' || t.cat == cat}
  text "Spent: {money(abs(sum(filter(tx, 'cat', cat), 'amount')))}" if={cat != 'All'}
  text "Spent: {money(abs(sum(tx, 'amount') - sum(filter(tx, 'cat', 'Income'), 'amount')))}" if={cat == 'All'}
`, (ui) => { expect(ui.text()).toContain("Spent: $169.52"); expect(ui.text()).toContain("$2,400.00"); ui.set("cat", "Groceries"); expect(ui.text()).toContain("Spent: $123.02"); }],
  returns: [`state items=[{name: "Trail runners", price: 129, ret: false}, {name: "Wool socks", price: 24, ret: false}]
card
  each items=items as=it
    check "{it.name}" bind=it.ret
  text "{plural(count(items, 'ret'), 'item')} selected · refund {money(sum(filter(items, 'ret'), 'price'))}"
`, (ui) => { ui.press({ type: "check", text: "Wool socks" }); expect(ui.text()).toContain("1 item selected · refund $24.00"); }],
  hotel: [`state room="k" nights=2 rooms=[{id: "q", name: "Queen", rate: 189}, {id: "k", name: "King", rate: 249}]
card
  each items=rooms as=r
    radio "{r.name}" bind=room value={r.id}
  text "Total {money(nights * find(rooms, 'id', room).rate)}"
`, (ui) => { expect(ui.text()).toContain("Total $498.00"); ui.press({ type: "radio", text: "Queen" }); expect(ui.text()).toContain("Total $378.00"); }],
  quiz: [`state checked=false qs=[{q: "Capital of Arizona?", options: ["Tucson", "Phoenix"], answer: "Phoenix", ok: false}, {q: "Capital of Texas?", options: ["Austin", "Dallas"], answer: "Austin", ok: false}]
card
  each items=qs as=q
    text "{q.q}"
    each items=q.options as=o
      radio "{o}" bind=q.pick value={o} on="set:q.ok:{o == q.answer}"
  button "Check" on=set:checked:true
  text "Score: {count(qs, 'ok')} of {len(qs)}" if=checked
`, (ui) => { ui.press({ type: "radio", text: "Phoenix" }); ui.press({ type: "radio", text: "Dallas" }); ui.press("button"); expect(ui.text()).toContain("Score: 1 of 2"); }],
  dashboard: [`state days=[{d: "Mon", rev: 4200}, {d: "Sat", rev: 7300}, {d: "Sun", rev: 5600}] top=[{name: "Runners", units: 84}, {name: "Socks", units: 203}]
card
  stat label="Revenue" value={money(sum(days, 'rev'))}
  stat label="Best day" value="{find(days, 'rev', max(days, 'rev')).d} · {money(max(days, 'rev'))}"
  list
    each items={sort(top, 'units', 'desc')} as=p
      list-item "{p.name}" trailing="{number(p.units)} sold"
`, (ui) => { expect(ui.text()).toEqual(expect.arrayContaining(["$17,100.00", "Sat · $7,300.00"])); expect(ui.text().indexOf("Socks")).toBeLessThan(ui.text().indexOf("Runners")); }],
  weather: [`state days=[{d: "Wed", hi: 64, sky: "Sunny"}]
text "{days[0].hi}° and {lower(days[0].sky)} today"
`, (ui) => { expect(ui.text()).toContain("64° and sunny today"); }],
  noresults: [`state topic="billing" articles=[{title: "Reset password", topic: "account"}]
list
  each items=articles as=a
    list-item "{a.title}" if={a.topic == topic}
empty "No articles about {topic}" if={count(articles, 'topic', topic) == 0}
`, (ui) => { expect(ui.text()).toContain("No articles about billing"); }],
};
for (const [name, [spec, check]] of Object.entries(screens)) {
  it(name, () => { const ui = render(spec); expect(ui.diagnostics).toEqual([]); expect(ui.warnings).toEqual([]); check(ui); });
}

describe("typing samples", () => {
  it("Search filters as you type, counts matches, and clears", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.search!.spec);
    expect(ui.diagnostics).toEqual([]);
    expect(ui.text()).toContain("8 trails");
    ui.type("input", "pe");
    ui.key("Escape");
    expect(ui.text()).toEqual(expect.arrayContaining(["1 trail", "Piestewa Peak"]));
    ui.type("input", "zz");
    ui.key("Escape");
    expect(ui.text()).toContain("No trails match pezz");
    ui.press("empty");
    expect(ui.text()).toContain("8 trails");
  });

  it("Packing list adds an item someone types", async () => {
    const { samples } = await import("../playground/samples");
    const ui = render(samples.packing!.spec);
    expect(ui.diagnostics).toEqual([]);
    ui.type("input", "Sunscreen");
    ui.key("Enter");
    expect(ui.text()).toContain("Sunscreen");
    expect(ui.state.item).toBe("");
  });
});
