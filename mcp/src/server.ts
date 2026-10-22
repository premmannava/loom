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

let guideCache: string | null = null;
/** The full guide plus the chat notes. Generated once from the component definitions. */
export function guideText(): string {
  guideCache ??= languageGuide(registry, { mode: "full", imageHosts: [], notes: CHAT_NOTES });
  return guideCache;
}

export interface SpecCheck {
  errors: Diagnostic[];
  warnings: Diagnostic[];
}

/** Parse a spec with the engine's own parser and components. Never throws. */
export function checkSpec(spec: string): SpecCheck {
  const { diagnostics } = parse(spec, registry);
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
}

export function createServer(opts: ServerOptions): McpServer {
  const server = new McpServer(
    { name: "sayshape", title: "SayShape", version: VERSION },
    {
      instructions:
        "The person installed SayShape so that visual answers appear as interactive SayShape interfaces inside the chat. " +
        "Whenever they ask for a chart, graph, table, dashboard, scorecard, stat card, form, calculator, tracker, checklist or any other visual or interactive answer, " +
        "use SayShape for it rather than writing HTML, React, SVG or chart code, or making an artifact. " +
        "Call sayshape_guide once per conversation to learn the language, then call show_interface with a spec.",
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
    async () => ({ content: [{ type: "text", text: guideText() }] }),
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
        "The result lists any lines the parser skipped, so you can fix them.",
      inputSchema: {
        spec: z.string().min(1).max(MAX_SPEC_CHARS).describe("The SayShape spec: plain lines, no Markdown fences."),
        title: z.string().max(120).optional().describe("A short name for the interface, e.g. 'Paris 2024 medal table'."),
      },
      annotations: { readOnlyHint: true, openWorldHint: false },
      _meta: { ui: { resourceUri: UI_URI } },
    },
    async ({ spec, title }) => {
      const check = checkSpec(spec);
      return {
        content: [{ type: "text", text: describeCheck(check) }],
        structuredContent: {
          title: title ?? null,
          errors: check.errors.length,
          warnings: check.warnings.length,
          diagnostics: [...check.errors, ...check.warnings].slice(0, MAX_REPORTED).map((d) => ({ line: d.line, severity: d.severity, message: d.message })),
        },
      };
    },
  );

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
