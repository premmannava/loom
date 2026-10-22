#!/usr/bin/env node
/**
 * Runs the SayShape MCP server.
 *
 *   sayshape-mcp                 stdio, for Claude Desktop, Claude Code, VS Code, Goose…
 *   sayshape-mcp --data file.db  also let the model query a SQLite database (read-only)
 *   sayshape-mcp --http [port]   Streamable HTTP on /mcp (default port 3001), for
 *                                clients that connect to a URL. Bind it behind
 *                                HTTPS before exposing it beyond localhost.
 */
import { readFile } from "node:fs/promises";
import { createServer as createHttpServer, type IncomingMessage } from "node:http";
import { fileURLToPath } from "node:url";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createServer } from "./server";
import { DataSource } from "./data";

// dist/server.js and dist/ui.html sit side by side.
const UI_PATH = fileURLToPath(new URL("./ui.html", import.meta.url));
let uiCache: Promise<string> | null = null;
const uiHtml = () => (uiCache ??= readFile(UI_PATH, "utf8"));

const MAX_BODY_BYTES = 1_000_000;

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    size += (chunk as Buffer).length;
    if (size > MAX_BODY_BYTES) throw new Error("too large");
    chunks.push(chunk as Buffer);
  }
  return chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : undefined;
}

async function serveHttp(port: number, data: DataSource | undefined): Promise<void> {
  const http = createHttpServer(async (req, res) => {
    if (new URL(req.url ?? "/", "http://localhost").pathname !== "/mcp") {
      res.writeHead(404, { "Content-Type": "text/plain" }).end("SayShape MCP server: use /mcp\n");
      return;
    }
    if (req.method !== "POST") {
      // Stateless: no server-sent event streams to resume and no sessions to end.
      res.writeHead(405, { Allow: "POST" }).end();
      return;
    }
    try {
      const body = await readJson(req);
      // A fresh server and transport per request keeps requests independent.
      // Datasets live in the shared DataSource, so a later request (the interface fetching rows) finds them.
      const server = createServer({ uiHtml, data });
      const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
      res.on("close", () => { void transport.close(); void server.close(); });
      await server.connect(transport);
      await transport.handleRequest(req, res, body);
    } catch {
      if (!res.headersSent) res.writeHead(400, { "Content-Type": "application/json" }).end(JSON.stringify({ jsonrpc: "2.0", error: { code: -32700, message: "Bad request" }, id: null }));
    }
  });
  await new Promise<void>((done) => http.listen(port, "127.0.0.1", done));
  console.error(`SayShape MCP server on http://127.0.0.1:${port}/mcp`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes("--help") || args.includes("-h")) {
    console.error("Usage: sayshape-mcp [--data database.db] [--http [port]]");
    return;
  }
  const dataAt = args.indexOf("--data");
  let data: DataSource | undefined;
  if (dataAt >= 0) {
    const path = args[dataAt + 1];
    if (!path || path.startsWith("--")) throw new Error("--data needs the path to a SQLite database file.");
    data = await DataSource.open(path);
    console.error(`SayShape: reading ${path} (read-only)`);
  }
  const httpAt = args.indexOf("--http");
  if (httpAt >= 0) {
    const port = Number(args[httpAt + 1] ?? 3001);
    await serveHttp(Number.isInteger(port) && port > 0 ? port : 3001, data);
    return;
  }
  // stdout carries the protocol, so anything for people goes to stderr.
  await createServer({ uiHtml, data }).connect(new StdioServerTransport());
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
