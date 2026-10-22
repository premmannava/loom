/**
 * The SayShape MCP server: lets any MCP Apps client (Claude, ChatGPT, VS Code,
 * Goose…) show SayShape interfaces inside the conversation.
 *
 *   sayshape_guide   returns the language guide, generated from the same
 *                    component definitions the engine renders with
 *   show_interface   takes a spec, checks it with the real parser and
 *                    returns the problems; the client shows the ui:// view,
 *                    which draws the spec with the real engine
 *
 * With a database (main.ts --data), three more tools let the model look at the
 * data and query it, and the interface load the rows itself:
 *
 *   describe_data    tables, columns, row counts and joins
 *   query_data       one read-only SELECT; keeps the rows as a dataset and
 *                    tells the model only its columns, size and a sample
 *   fetch_dataset    for the interface only (visibility: app): a dataset's rows
 *
 * The model only ever sends text. The view (src/ui) parses and paints it, and
 * the only thing that leaves an interface is an emit: action, which the view
 * turns into a message in the conversation. So the client's iframe sandbox is
 * a second wall, not the first one.
 *
 * This file has no I/O of its own: main.ts connects it to stdio or HTTP, and
 * the tests connect it to an in-memory client.
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { registerAppResource, registerAppTool, RESOURCE_MIME_TYPE } from "@modelcontextprotocol/ext-apps/server";
import { z } from "zod";
import { parse } from "../../src/parser";
import { Registry } from "../../src/registry";
import { coreComponents } from "../../src/components";
import { languageGuide } from "../../src/prompt";
import type { Diagnostic } from "../../src/types";
import { QueryError, summarize, type DataSource } from "./data";

export const VERSION = "0.1.0";
export const UI_URI = "ui://sayshape/interface.html";
/** Longer specs are refused: they're slow to stream and nobody reads them in a chat. */
export const MAX_SPEC_CHARS = 20_000;
/** How many problems go back to the model; the first few are what it needs to fix. */
const MAX_REPORTED = 12;

const registry = new Registry(coreComponents);

/** Extra rules for a model writing into a chat, on top of the generated guide. */
const CHAT_NOTES = `This guide calls the language Loom, its earlier name: it is the same language as SayShape.
You are writing an interface that appears inside a chat conversation, in a narrow column about 600 pixels wide.
Keep it to one focused screen: a card or column with a title, then the content. Prefer row and grid for side-by-side numbers; avoid more than three columns.
Put the data you know straight into state (lists of records for tables, charts and each). Never claim data is live: if numbers come from your own knowledge, say so in a caption.
When the person should be able to send something back to you (a choice, a form, an approval), give it a button with on=emit:name, for example on=emit:submit_order. You will receive a message naming the action, its value and every state value, and you can reply or call show_interface again with an updated spec.
Output only the spec in show_interface's spec argument, with no Markdown fences.`;

/** How to show a database's rows, added to the guide when the server has one. */
const DATA_NOTES = `DATA FROM THE DATABASE
- Look at the tables with describe_data, then get exactly the rows you need with query_data (one SELECT). Do the work in SQL: GROUP BY, SUM, COUNT, ORDER BY, LIMIT. A query keeps at most 500 rows.
- query_data returns a dataset id (d1, d2…), its columns and a few sample rows. Never type the rows or their numbers into the spec.
- Show a dataset by naming it in show_interface's data argument and using that name in the spec: data={"sales": "d1"}, then chart "Sales by country" kind=bar items=sales x=Country y=Total, or table … items=sales with table-column field=… for each column. Each row is a record with the dataset's column names as fields.
- Don't declare a dataset's name with state: the interface fills it in. You can still derive from it: derive top={take(sort(sales, 'Total', 'desc'), 5)}.`;

const guideCache = new Map<boolean, string>();
/** The full guide plus the chat notes (and the data notes when there's a database). Generated once from the component definitions. */
export function guideText(withData = false): string {
  let g = guideCache.get(withData);
  if (!g) {
    g = languageGuide(registry, { mode: "full", imageHosts: [], notes: withData ? `${CHAT_NOTES}\n\n${DATA_NOTES}` : CHAT_NOTES });
    guideCache.set(withData, g);
  }
  return g;
}

export interface SpecCheck {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/** Parse a spec with the engine's own parser and components. Never throws. hostNames: state the interface fills in (datasets). */
export function checkSpec(spec: string, hostNames: readonly string[] = []): SpecCheck {
  const { diagnostics } = parse(spec, registry, { knownNames: hostNames });
  return {
    errors: diagnostics.filter((d) => d.severity === "error"),
    warnings: diagnostics.filter((d) => d.severity !== "error"),
  };
}

function describeCheck(c: SpecCheck): string {
  const all = [...c.errors, ...c.warnings];
  if (!all.length) return "The interface is showing in the conversation, with no problems.";
  const lines = all.slice(0, MAX_REPORTED).map((d) => `line ${d.line} (${d.severity}): ${d.message}`);
  if (all.length > MAX_REPORTED) lines.push(`…and ${all.length - MAX_REPORTED} more.`);
  const lead = c.errors.length
    ? `The interface is showing, but ${c.errors.length} line${c.errors.length === 1 ? " was" : "s were"} skipped. Fix these and call show_interface again with the whole corrected spec:`
    : "The interface is showing. The parser noted these smaller problems; fix them if they matter:";
  return `${lead}\n${lines.join("\n")}`;
}

export interface ServerOptions {
  /** The view's HTML: dist/ui.html, built by `npm run build`. */
  uiHtml: () => string | Promise<string>;
  /** A read-only database the model may query (main.ts --data). */
  data?: DataSource;
}

/** Names a dataset can be shown under: plain state names. */
const DATA_NAME = /^[A-Za-z_][A-Za-z0-9_]{0,40}$/;

const text = (t: string, isError = false) => ({ content: [{ type: "text" as const, text: t }], ...(isError ? { isError: true } : {}) });

export function createServer(opts: ServerOptions): McpServer {
  const data = opts.data;
  const server = new McpServer(
    { name: "sayshape", title: "SayShape", version: VERSION },
    {
      instructions:
        "The person installed SayShape so that visual answers appear as interactive SayShape interfaces inside the chat. " +
        "Whenever they ask for a chart, graph, table, dashboard, scorecard, stat card, form, calculator, tracker, checklist or any other visual or interactive answer, " +
        "use SayShape for it rather than writing HTML, React, SVG or chart code, or making an artifact. " +
        "Call sayshape_guide once per conversation to learn the language, then call show_interface with a spec." +
        (data
          ? " A database is connected: answer questions about it with describe_data and query_data, then show the result with show_interface, " +
            "passing the dataset in its data argument instead of typing the numbers."
          : ""),
    },
  );

  server.registerTool(
    "sayshape_guide",
    {
      title: "SayShape language guide",
      description:
        "Returns the SayShape language guide: every element, prop, expression function and action, with examples. " +
        "Call it once per conversation, before your first show_interface call, whenever the person asks for a chart, table, dashboard, form, calculator or other visual answer.",
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    async () => ({ content: [{ type: "text", text: guideText(!!data) }] }),
  );

  registerAppTool(
    server,
    "show_interface",
    {
      title: "Show an interface",
      description:
        "Shows an interactive interface inside the conversation, drawn by the SayShape engine from a spec you write: " +
        "a card, table, chart, form, calculator, checklist or small dashboard. " +
        "Use this for every visual or interactive answer (charts, graphs, tables, dashboards, stat cards, forms, calculators, trackers) " +
        "rather than writing HTML, React, SVG or chart code, or making an artifact. The spec is SayShape, a line-based UI language " +
        "(one element per line, two-space indentation for nesting); read sayshape_guide first. Specs can't run code or choose colors. " +
        "The result lists any lines the parser skipped, so you can fix them." +
        (data ? " To show rows from the database, pass data={\"name\": \"d1\"} with a dataset id from query_data and use that name in the spec (items=name)." : ""),
      inputSchema: {
        spec: z.string().min(1).max(MAX_SPEC_CHARS).describe("The SayShape spec: plain lines, no Markdown fences."),
        title: z.string().max(120).optional().describe("A short name for the interface, e.g. 'Paris 2024 medal table'."),
        ...(data
          ? {
              data: z
                .record(z.string(), z.string())
                .optional()
                .describe('Datasets to load into the interface, by the name the spec uses: {"sales": "d1"}. Ids come from query_data.'),
            }
          : {}),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async (args) => {
      const { spec, title } = args;
      const wanted = ((args as { data?: Record<string, string> }).data ?? {}) as Record<string, string>;
      const datasets: Record<string, { id: string; rows: number }> = {};
      for (const [name, id] of Object.entries(wanted)) {
        if (!DATA_NAME.test(name)) return text(`"${name}" can't be used as a name in a spec. Use letters, digits and _, starting with a letter, like sales or top_artists.`, true);
        const d = data?.get(id);
        if (!d) return text(`There's no dataset "${id}". Run query_data first and use the id it returns (d1, d2…).`, true);
        datasets[name] = { id, rows: d.rows.length };
      }
      const names = Object.keys(datasets);
      const check = checkSpec(spec, names);
      // A state line would replace the rows the interface loads, so point it out.
      const declared = names.filter((n) => new RegExp(`^state\\b[^\\n]*\\b${n}=`, "m").test(spec));
      const notes = [
        ...(names.length ? [`Loaded into the interface: ${names.map((n) => `${n} (${datasets[n]!.id}, ${datasets[n]!.rows} rows)`).join(", ")}.`] : []),
        ...(declared.length ? [`Remove ${declared.join(", ")} from the state line: the interface fills ${declared.length === 1 ? "it" : "them"} in from the dataset.`] : []),
      ];
      return {
        content: [{ type: "text", text: [describeCheck(check), ...notes].join("\n") }],
        structuredContent: {
          datasets,
          title: title ?? null,
          errors: check.errors.length,
          warnings: check.warnings.length,
          diagnostics: [...check.errors, ...check.warnings].slice(0, MAX_REPORTED).map((d) => ({ line: d.line, severity: d.severity, message: d.message })),
        },
      };
    },
  );

  if (data) {
    server.registerTool(
      "describe_data",
      {
        title: "Describe the database",
        description: "Lists the connected database's tables and views with their columns, row counts and how they join. Call it before writing a query.",
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async () => text(data.describe()),
    );

    server.registerTool(
      "query_data",
      {
        title: "Query the database",
        description:
          "Runs one read-only SQL SELECT on the connected SQLite database and keeps the result as a dataset (at most 500 rows). " +
          "Returns the dataset id, its columns and a few sample rows; show it with show_interface's data argument. Aggregate in SQL rather than fetching raw rows.",
        inputSchema: { sql: z.string().min(1).max(10_000).describe("One SELECT (or WITH … SELECT) statement in SQLite syntax.") },
        annotations: { readOnlyHint: true, openWorldHint: false },
      },
      async ({ sql }) => {
        try {
          return text(summarize(data.query(sql)));
        } catch (e) {
          return text(e instanceof QueryError ? `The query didn't run: ${e.message}` : "The query didn't run.", true);
        }
      },
    );

    registerAppTool(
      server,
      "fetch_dataset",
      {
        title: "Fetch a dataset's rows",
        description: "Used by the SayShape interface to load a dataset's rows. Not for the model.",
        inputSchema: { id: z.string().max(20) },
        annotations: { readOnlyHint: true, openWorldHint: false },
        // Only the interface may call it: the rows go to the screen, not into the conversation.
        _meta: { ui: { resourceUri: UI_URI, visibility: ["app"] } },
      },
      async ({ id }) => {
        const d = data.get(id);
        if (!d) return text(`No dataset ${id}.`, true);
        return {
          content: [{ type: "text", text: `${d.rows.length} rows of ${d.id}.` }],
          structuredContent: { id: d.id, columns: d.columns, rows: d.rows, truncated: d.truncated },
        };
      },
    );
  }

  registerAppResource(server, "SayShape interface", UI_URI, { mimeType: RESOURCE_MIME_TYPE, description: "Draws a SayShape spec with the SayShape engine." }, async () => ({
    contents: [
      {
        uri: UI_URI,
        mimeType: RESOURCE_MIME_TYPE,
        text: await opts.uiHtml(),
        // Everything is inline: no scripts, styles, fonts or images from anywhere else.
        _meta: { ui: { prefersBorder: true } },
      },
    ],
  }));

  return server;
}
