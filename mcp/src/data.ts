/**
 * A read-only database the model can query, with the results kept here as
 * datasets. The model sees a dataset's columns, its size and a few sample
 * rows; the interface fetches the rows itself (fetch_dataset), so the numbers
 * people see come straight from the database and never pass through the model.
 *
 * Uses SQLite through Node's built-in node:sqlite (Node 22.13 or later), so
 * there is nothing to install. Safety:
 * - the file is opened read-only: SQLite refuses every write;
 * - only one SELECT (or WITH … SELECT) statement per query;
 * - results are capped (MAX_ROWS rows, and at most MAX_VALUES values, which is
 *   what one interface can hold), and the model is told to aggregate in SQL.
 */
import { createRequire } from "node:module";
import type { DatabaseSync, StatementSync } from "node:sqlite";

export type Cell = string | number | boolean | null;
export type Row = Record<string, Cell>;

export interface Column {
  name: string;
  type: "number" | "text" | "boolean" | "empty";
}

export interface Dataset {
  id: string;
  sql: string;
  columns: Column[];
  rows: Row[];
  /** True when the query returned more rows than were kept. */
  truncated: boolean;
}

/** Rows kept per dataset; an interface shows at most 500 copies of a list, and tables 200 rows. */
export const MAX_ROWS = 500;
/** Values (rows × columns) kept per dataset, under SayShape's 10,000-value limit for data. */
export const MAX_VALUES = 9_000;
/** Datasets remembered at once; older ones are dropped first. */
export const MAX_DATASETS = 100;
const SAMPLE_ROWS = 3;

export class QueryError extends Error {}

/** A single read-only statement, or a reason it isn't one. Trailing semicolons are fine. */
export function checkSql(sql: string): { ok: true; sql: string } | { ok: false; reason: string } {
  const s = sql.trim().replace(/;+\s*$/, "");
  if (!s) return { ok: false, reason: "The query is empty." };
  if (s.length > 10_000) return { ok: false, reason: "The query is too long (10,000 characters at most)." };
  // Strip string literals and comments before looking for statement separators and keywords.
  const bare = s.replace(/'(?:[^']|'')*'/g, "''").replace(/"(?:[^"]|"")*"/g, '""').replace(/--[^\n]*/g, " ").replace(/\/\*[\s\S]*?\*\//g, " ");
  if (bare.includes(";")) return { ok: false, reason: "Send one statement at a time (no ; between statements)." };
  if (!/^\s*(select|with)\b/i.test(bare)) return { ok: false, reason: "Only SELECT queries are allowed (WITH … SELECT is fine)." };
  if (/\b(attach|detach|pragma|insert|update|delete|create|drop|alter|vacuum|reindex)\b/i.test(bare)) {
    return { ok: false, reason: "Only reading is allowed: no ATTACH, PRAGMA or statements that change data." };
  }
  return { ok: true, sql: s };
}

function cell(v: unknown): Cell {
  if (v === null || v === undefined) return null;
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "bigint") return Number.isSafeInteger(Number(v)) ? Number(v) : v.toString();
  if (typeof v === "string" || typeof v === "boolean") return v;
  return null; // blobs and anything else can't be shown
}

function columnsOf(rows: readonly Row[], names: readonly string[]): Column[] {
  return names.map((name) => {
    const seen = rows.map((r) => r[name]).find((v) => v !== null && v !== undefined);
    const type = seen === undefined ? "empty" : typeof seen === "number" ? "number" : typeof seen === "boolean" ? "boolean" : "text";
    return { name, type };
  });
}

function namesOf(stmt: StatementSync, first: Row | undefined): string[] {
  const withColumns = stmt as unknown as { columns?: () => Array<{ name: string }> };
  if (typeof withColumns.columns === "function") {
    try { return withColumns.columns().map((c) => c.name); } catch { /* older Node */ }
  }
  return first ? Object.keys(first) : [];
}

export class DataSource {
  private readonly datasets = new Map<string, Dataset>();
  private next = 0;

  private constructor(private readonly db: DatabaseSync, readonly path: string) {}

  /** Open a SQLite file read-only. Throws a plain message if it can't. */
  static async open(path: string): Promise<DataSource> {
    let sqlite: typeof import("node:sqlite");
    try {
      // Node prints an "experimental" warning for node:sqlite; it would only add noise to the chat app's logs.
      const emit = process.emitWarning;
      process.emitWarning = ((w: string | Error, ...rest: unknown[]) => {
        const text = typeof w === "string" ? w : w.message;
        if (/SQLite/i.test(text)) return;
        (emit as (...a: unknown[]) => void).call(process, w, ...rest);
      }) as typeof process.emitWarning;
      // Loaded with require: bundlers and test runners don't all know node:sqlite yet.
      sqlite = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
    } catch {
      throw new Error("Reading a database needs Node.js 22.13 or later (it uses Node's built-in SQLite).");
    }
    try {
      // readOnly is in Node 22.13+; the @types/node version pinned here predates it.
      const options = { readOnly: true } as unknown as ConstructorParameters<typeof sqlite.DatabaseSync>[1];
      return new DataSource(new sqlite.DatabaseSync(path, options), path);
    } catch (e) {
      throw new Error(`Couldn't open the database ${path}: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  /** Every table and view with its columns and row count, for the model. */
  describe(): string {
    const tables = this.db.prepare("SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%' ORDER BY name").all() as Array<{ name: string; type: string }>;
    const quote = (n: string) => `"${n.replace(/"/g, '""')}"`;
    const lines = tables.map((t) => {
      const cols = this.db.prepare(`SELECT name, type, pk FROM pragma_table_info(?)`).all(t.name) as Array<{ name: string; type: string; pk: number }>;
      let count = "";
      try { count = `, ${(this.db.prepare(`SELECT count(*) AS n FROM ${quote(t.name)}`).get() as { n: number }).n} rows`; } catch { /* a broken view */ }
      const colText = cols.map((c) => `${c.name} ${c.type || "any"}${c.pk ? " (key)" : ""}`).join(", ");
      return `${t.name} (${t.type}${count}): ${colText}`;
    });
    const keys = tables.flatMap((t) =>
      (this.db.prepare(`SELECT "from" AS col, "table" AS ref, "to" AS refcol FROM pragma_foreign_key_list(?)`).all(t.name) as Array<{ col: string; ref: string; refcol: string }>)
        .map((f) => `${t.name}.${f.col} → ${f.ref}.${f.refcol}`),
    );
    return [`Database: ${tables.length} tables and views.`, ...lines, ...(keys.length ? ["", "Joins:", ...keys] : [])].join("\n");
  }

  /** Run a read-only query and keep its rows as a new dataset. */
  query(sql: string): Dataset {
    const checked = checkSql(sql);
    if (!checked.ok) throw new QueryError(checked.reason);
    let stmt: StatementSync;
    try { stmt = this.db.prepare(checked.sql); } catch (e) { throw new QueryError(e instanceof Error ? e.message : String(e)); }
    // Integers come back as bigint, so values past 2^53 become exact text instead of an error (cell()).
    stmt.setReadBigInts(true);
    const rows: Row[] = [];
    let truncated = false;
    let names: string[] = [];
    try {
      // iterate() stops early at the cap; older Node only has all().
      const it = (stmt as unknown as { iterate?: () => Iterable<Record<string, unknown>> }).iterate;
      const iterable = typeof it === "function" ? it.call(stmt) : stmt.all();
      for (const raw of iterable as Iterable<Record<string, unknown>>) {
        const row: Row = {};
        for (const [k, v] of Object.entries(raw)) row[k] = cell(v);
        if (!names.length) names = namesOf(stmt, row);
        if (rows.length >= MAX_ROWS || (rows.length + 1) * Math.max(1, names.length) > MAX_VALUES) { truncated = true; break; }
        rows.push(row);
      }
    } catch (e) {
      throw new QueryError(e instanceof Error ? e.message : String(e));
    }
    if (!names.length) names = namesOf(stmt, undefined);
    const id = `d${++this.next}`;
    const dataset: Dataset = { id, sql: checked.sql, columns: columnsOf(rows, names), rows, truncated };
    this.datasets.set(id, dataset);
    while (this.datasets.size > MAX_DATASETS) this.datasets.delete(this.datasets.keys().next().value!);
    return dataset;
  }

  get(id: string): Dataset | undefined {
    return this.datasets.get(id);
  }

  close(): void {
    this.db.close();
  }
}

/** What the model is told about a dataset: enough to design with, never the full rows. */
export function summarize(d: Dataset): string {
  const cols = d.columns.map((c) => `${c.name} (${c.type})`).join(", ") || "none";
  const size = d.truncated ? `the first ${d.rows.length} rows (the query returned more; aggregate with GROUP BY or add LIMIT)` : `${d.rows.length} row${d.rows.length === 1 ? "" : "s"}`;
  const sample = d.rows.slice(0, SAMPLE_ROWS).map((r) => JSON.stringify(r)).join("\n");
  return [
    `Dataset ${d.id}: ${size}.`,
    `Columns: ${cols}.`,
    ...(sample ? [`Sample rows (for designing only; don't copy values into the spec):\n${sample}`] : ["It has no rows."]),
    `To show it: call show_interface with data={"<name>": "${d.id}"} and use that name in the spec, e.g. items=<name>. The interface loads the rows itself.`,
  ].join("\n");
}
