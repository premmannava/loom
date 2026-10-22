import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createRequire } from "node:module";
import type { DatabaseSync as Db } from "node:sqlite";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { checkSql, DataSource, MAX_ROWS, QueryError, summarize } from "../src/data";
import { createServer } from "../src/server";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
type DatabaseSync = Db;

let dir: string;
let path: string;
let data: DataSource;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), "sayshape-data-"));
  path = join(dir, "shop.db");
  const db = new DatabaseSync(path);
  db.exec(`
    CREATE TABLE customer (id INTEGER PRIMARY KEY, name TEXT, country TEXT);
    CREATE TABLE sale (id INTEGER PRIMARY KEY, customer_id INTEGER REFERENCES customer(id), total REAL, big INTEGER);
  `);
  const c = db.prepare("INSERT INTO customer (name, country) VALUES (?, ?)");
  [["Ada", "UK"], ["Lin", "China"], ["Sam", "USA"], ["Ana", "USA"]].forEach(([n, k]) => c.run(n!, k!));
  const s = db.prepare("INSERT INTO sale (customer_id, total, big) VALUES (?, ?, ?)");
  for (let i = 0; i < 1200; i++) s.run((i % 4) + 1, 1.5 + (i % 10), 9007199254740993n);
  db.close();
  data = await DataSource.open(path);
});

afterAll(() => {
  data.close();
  rmSync(dir, { recursive: true, force: true });
});

describe("checkSql", () => {
  it("accepts one SELECT or WITH statement, with a trailing semicolon", () => {
    expect(checkSql("SELECT 1;")).toEqual({ ok: true, sql: "SELECT 1" });
    expect(checkSql("with t as (select 1 x) select * from t").ok).toBe(true);
    expect(checkSql("SELECT replace(name, 'a', 'b') FROM customer").ok).toBe(true);
    expect(checkSql("SELECT 'a;b' AS s").ok).toBe(true);
  });

  it("refuses anything else", () => {
    for (const sql of ["", "DELETE FROM sale", "SELECT 1; DROP TABLE sale", "PRAGMA table_info(sale)", "ATTACH 'x.db' AS x", "UPDATE sale SET total = 0", "SELECT 1 -- ok\n; DELETE FROM sale"]) {
      expect(checkSql(sql).ok, sql).toBe(false);
    }
  });
});

describe("DataSource", () => {
  it("describes tables, columns, row counts and joins", () => {
    const d = data.describe();
    expect(d).toMatch(/customer \(table, 4 rows\): id INTEGER \(key\), name TEXT, country TEXT/);
    expect(d).toMatch(/sale \(table, 1200 rows\)/);
    expect(d).toMatch(/sale\.customer_id → customer\.id/);
  });

  it("keeps a query's rows as a dataset, with typed columns", () => {
    const d = data.query("SELECT country, COUNT(*) AS customers FROM customer GROUP BY country ORDER BY customers DESC");
    expect(d.id).toMatch(/^d\d+$/);
    expect(d.columns).toEqual([{ name: "country", type: "text" }, { name: "customers", type: "number" }]);
    expect(d.rows[0]).toEqual({ country: "USA", customers: 2 });
    expect(d.truncated).toBe(false);
    expect(data.get(d.id)).toBe(d);
  });

  it("caps big results and says so", () => {
    const d = data.query("SELECT id, total FROM sale");
    expect(d.rows.length).toBe(MAX_ROWS);
    expect(d.truncated).toBe(true);
    expect(summarize(d)).toMatch(/the first 500 rows .*aggregate with GROUP BY/);
  });

  it("turns integers too big for JavaScript into text, not wrong numbers", () => {
    expect(data.query("SELECT big FROM sale LIMIT 1").rows[0]).toEqual({ big: "9007199254740993" });
  });

  it("reports SQL errors plainly", () => {
    expect(() => data.query("SELECT nope FROM sale")).toThrow(QueryError);
    expect(() => data.query("DELETE FROM sale")).toThrow(/Only SELECT/);
  });

  it("opens the file read-only, so even a write that got past the check would fail", () => {
    const db = (data as unknown as { db: DatabaseSync }).db;
    expect(() => db.exec("DELETE FROM sale")).toThrow(/readonly/i);
  });

  it("summarizes for the model without the full rows", () => {
    const d = data.query("SELECT id, total FROM sale WHERE id <= 40");
    const s = summarize(d);
    expect(s).toMatch(/Dataset d\d+: 40 rows/);
    expect(s.match(/"id":/g)?.length).toBe(3);
    expect(s).toMatch(/data=\{"<name>": "d\d+"\}/);
  });
});

describe("the data tools", () => {
  async function connect(withData = true) {
    const server = createServer({ uiHtml: () => "<!doctype html>", data: withData ? data : undefined });
    const client = new Client({ name: "test", version: "1.0.0" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([server.connect(a), client.connect(b)]);
    return client;
  }
  const textOf = (r: Record<string, unknown>) => ((r.content as Array<{ text?: string }>)[0]?.text ?? "");

  it("only exist when a database is connected", async () => {
    const without = (await (await connect(false)).listTools()).tools.map((t) => t.name);
    expect(without).not.toContain("query_data");
    const withData = await connect();
    const tools = (await withData.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual(["describe_data", "fetch_dataset", "query_data", "sayshape_docs", "show_interface"]);
    // fetch_dataset is for the interface only: hosts hide it from the model.
    expect((tools.find((t) => t.name === "fetch_dataset")!._meta as { ui: { visibility: string[] } }).ui.visibility).toEqual(["app"]);
    expect(withData.getInstructions()).toMatch(/query_data/);
  });

  it("let a model describe, query and show a dataset, and the interface fetch its rows", async () => {
    const client = await connect();
    expect(textOf(await client.callTool({ name: "describe_data", arguments: {} }))).toMatch(/customer/);

    const q = await client.callTool({ name: "query_data", arguments: { sql: "SELECT country, SUM(total) AS revenue FROM sale JOIN customer ON customer.id = sale.customer_id GROUP BY country" } });
    const id = /Dataset (d\d+)/.exec(textOf(q))![1]!;

    const spec = `card\n  chart "Revenue" kind=bar items=sales x=country y=revenue\n  table "By country" items=sales key=country\n    table-column "Country" field=country\n    table-column "Revenue" field=revenue\n`;
    const shown = await client.callTool({ name: "show_interface", arguments: { spec, data: { sales: id } } });
    expect(shown.isError).toBeFalsy();
    expect(textOf(shown)).toMatch(/no problems/);
    expect(textOf(shown)).toMatch(new RegExp(`Loaded into the interface: sales \\(${id}, 3 rows\\)`));

    const fetched = await client.callTool({ name: "fetch_dataset", arguments: { id } });
    const rows = (fetched.structuredContent as { rows: Array<{ country: string; revenue: number }> }).rows;
    expect(rows.map((r) => r.country).sort()).toEqual(["China", "UK", "USA"]);
  });

  it("refuse unknown datasets and bad names, and point out a state line that would hide the data", async () => {
    const client = await connect();
    const unknown = await client.callTool({ name: "show_interface", arguments: { spec: "card\n", data: { sales: "d999" } } });
    expect(unknown.isError).toBe(true);
    const id = /Dataset (d\d+)/.exec(textOf(await client.callTool({ name: "query_data", arguments: { sql: "SELECT 1 AS x" } })))![1]!;
    const bad = await client.callTool({ name: "show_interface", arguments: { spec: "card\n", data: { "bad name": id } } });
    expect(bad.isError).toBe(true);
    const declared = await client.callTool({ name: "show_interface", arguments: { spec: `state rows=[]\ntable "T" items=rows key=x\n  table-column "X" field=x\n`, data: { rows: id } } });
    expect(textOf(declared)).toMatch(/Remove rows from the state line/);
  });

  it("report query errors to the model instead of failing", async () => {
    const client = await connect();
    const r = await client.callTool({ name: "query_data", arguments: { sql: "DROP TABLE sale" } });
    expect(r.isError).toBe(true);
    expect(textOf(r)).toMatch(/didn't run: Only SELECT/);
  });

  it("offer the database topic only when there's a database", async () => {
    const withData = textOf(await (await connect()).callTool({ name: "sayshape_docs", arguments: { topics: ["database"] } }));
    const without = textOf(await (await connect(false)).callTool({ name: "sayshape_docs", arguments: { topics: ["database"] } }));
    expect(withData).toMatch(/DATA FROM THE DATABASE/);
    expect(without).toMatch(/No topic called database/);
  });
});
