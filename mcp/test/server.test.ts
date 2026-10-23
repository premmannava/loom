import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { createServer, checkSpec, guideText, quickStart, UI_URI, MAX_SPEC_CHARS } from "../src/server";

async function connect() {
  const server = createServer({ uiHtml: () => "<!doctype html><title>view</title>" });
  const client = new Client({ name: "test", version: "1.0.0" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  return client;
}

const GOOD = `state days=2
card
  text "Weekend hike" style=title
  stat label="Days" value={days}
  button "Add day" on=inc:days
`;

const text = (r: Record<string, unknown>) => ((r.content as Array<{ type: string; text?: string }>)[0]?.text ?? "");

describe("SayShape MCP server", () => {
  it("lists both tools, and show_interface points at the view", async () => {
    const client = await connect();
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(["sayshape_docs", "show_interface"]);
    const show = tools.find((t) => t.name === "show_interface")!;
    expect((show._meta as { ui?: { resourceUri?: string } }).ui?.resourceUri).toBe(UI_URI);
    expect(show.inputSchema.required).toEqual(["spec"]);
    expect(show.annotations?.readOnlyHint).toBe(true);
  });

  it("tells the model when to use it, through the server instructions", async () => {
    const client = await connect();
    expect(client.getInstructions()).toMatch(/show_interface/);
  });

  it("carries a short quick start in show_interface: the syntax and every element's name", async () => {
    const client = await connect();
    const show = (await client.listTools()).tools.find((t) => t.name === "show_interface")!;
    expect(show.description).toContain(quickStart());
    for (const element of ["card", "table", "chart", "button", "each", "stepper", "date-picker"]) expect(show.description).toMatch(new RegExp(`\\b${element}\\b`));
    expect(show.description).toMatch(/sayshape_docs/);
    // Small enough to send with every call: about 400 tokens, against about 7,500 for the whole guide.
    expect(quickStart().length).toBeLessThan(2_000);
    expect(guideText().length).toBeGreaterThan(20_000);
  });

  it("gives docs for just the elements and topics asked for, generated from the component definitions", async () => {
    const client = await connect();
    const docs = text(await client.callTool({ name: "sayshape_docs", arguments: { elements: ["table"], topics: ["actions"] } }));
    // A table brings its table-column along; nothing else comes with it.
    expect(docs).toMatch(/^ {2}table "<text>"/m);
    expect(docs).toMatch(/^ {2}table-column "<text>"/m);
    expect(docs).not.toMatch(/^ {2}stepper/m);
    expect(docs).toMatch(/ACTIONS/);
    expect(docs.length).toBeLessThan(guideText().length / 5);
  });

  it("says so when an element or topic doesn't exist, and lists the real ones", async () => {
    const client = await connect();
    const docs = text(await client.callTool({ name: "sayshape_docs", arguments: { elements: ["piechart"], topics: ["css"] } }));
    expect(docs).toMatch(/No element called piechart\. The elements are:/);
    expect(docs).toMatch(/No topic called css\. Topics: expressions, actions, lists/);
  });

  it("returns the quick start when nothing is named", async () => {
    const client = await connect();
    expect(text(await client.callTool({ name: "sayshape_docs", arguments: {} }))).toBe(quickStart());
  });

  it("sends the docs for an element along with the lines that went wrong", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: `card
  chart "Sales" kind=area items=[] x=a y=b
` } });
    const t = text(r);
    expect(t).toMatch(/line 2/);
    expect(t).toMatch(/Docs for chart:/);
    expect(t).toMatch(/kind=<bar\|hbar\|line/);
  });

  it("accepts a valid spec and reports no problems", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: GOOD, title: "Hike" } });
    expect(r.isError).toBeFalsy();
    expect(text(r)).toMatch(/no problems/);
    expect(r.structuredContent).toMatchObject({ title: "Hike", errors: 0, warnings: 0 });
  });

  it("reports skipped lines with line numbers, so the model can fix them", async () => {
    const client = await connect();
    const spec = `card\n  button "Go" colour=red\n  sparkle "nope"\n`;
    const r = await client.callTool({ name: "show_interface", arguments: { spec } });
    const t = text(r);
    expect(t).toMatch(/line 3 \(error\)/);
    expect(t).toMatch(/sparkle/);
    expect(t).toMatch(/call show_interface again/);
    expect(r.structuredContent).toMatchObject({ errors: 1 });
  });

  it("says when there's nothing to fix, so the model doesn't call again over an ignored prop", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: `card\n  button "Go" colour=red on=inc:n\n` } });
    const t = text(r);
    expect(t).toMatch(/showing correctly/);
    expect(t).toMatch(/no need to call show_interface again/);
    expect(t).toMatch(/line 2 \(ignored\)/);
    expect(t).not.toMatch(/Docs for/);
    expect(r.structuredContent).toMatchObject({ toFix: 0 });
  });

  it("asks for a fix when a warning leaves the interface wrong: an unknown function or a bad choice", async () => {
    const client = await connect();
    const spec = `state rows=[{m: "Jan", v: 3}]\ncard\n  text "Best: {argmax(rows).m}"\n  chart "Sales" kind=area items=rows x=m y=v\n`;
    const r = await client.callTool({ name: "show_interface", arguments: { spec } });
    const t = text(r);
    expect(t).toMatch(/2 problems leave part of it wrong/);
    expect(t).toMatch(/call show_interface again/);
    expect(t).toMatch(/Use first\(sort\(list, 'field', 'desc'\)\)/);
    expect(r.structuredContent).toMatchObject({ toFix: 2 });
  });

  it("tidies fences and typographic quotes instead of reporting them", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "show_interface", arguments: { spec: "```sayshape\ncard\n  text “Hello”\n```" } });
    expect(text(r)).toMatch(/no problems/);
  });

  it("lists every expression function in the quick start, with the best-row pattern", () => {
    expect(quickStart()).toMatch(/Functions \(no others exist\): .*\bfirst\b.*\btake\b/);
    expect(quickStart()).toMatch(/first\(sort\(rows, 'revenue', 'desc'\)\)\.month/);
  });

  it("refuses an empty or oversized spec", async () => {
    const client = await connect();
    const empty = await client.callTool({ name: "show_interface", arguments: { spec: "" } });
    expect(empty.isError).toBe(true);
    const huge = await client.callTool({ name: "show_interface", arguments: { spec: "text \"x\"\n".repeat(MAX_SPEC_CHARS) } });
    expect(huge.isError).toBe(true);
  });

  it("serves the view as an MCP Apps HTML resource", async () => {
    const client = await connect();
    const { resources } = await client.listResources();
    expect(resources.map((r) => r.uri)).toContain(UI_URI);
    const { contents } = await client.readResource({ uri: UI_URI });
    expect(contents[0]).toMatchObject({ uri: UI_URI, mimeType: RESOURCE_MIME_TYPE });
    expect((contents[0] as { text: string }).text).toMatch(/<!doctype html>/);
  });

  it("never throws on hostile input", () => {
    for (const spec of ["\u0000", "card\n".repeat(200) + "  ".repeat(500) + "text", "{constructor.constructor('x')()}", "state a={b}\nderive b={a}\n"]) {
      expect(() => checkSpec(spec)).not.toThrow();
    }
  });
});
