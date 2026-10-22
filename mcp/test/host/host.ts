/**
 * A minimal MCP Apps host for the end-to-end check (scripts/e2e.mjs): it puts
 * the built view in a sandboxed iframe, the way Claude or ChatGPT does, and
 * exposes the bridge so the script can stream tool input and read messages.
 */
import { AppBridge, PostMessageTransport } from "@modelcontextprotocol/ext-apps/app-bridge";
import type { McpUiStyles } from "@modelcontextprotocol/ext-apps";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";

declare global {
  interface Window {
    host: {
      ready: Promise<void>;
      bridge: AppBridge;
      messages: string[];
      sizes: number[];
      /** Server tools the view called (with serverTools on). */
      calls: Array<{ name: string; arguments: Record<string, unknown> }>;
    };
    /** Set by the e2e script: forwards a tool call to the real MCP server. */
    callServer?: (name: string, args: Record<string, unknown>) => Promise<CallToolResult>;
  }
}

export function mount(html: string, theme: "light" | "dark", styles?: Record<string, string>, serverTools = false): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("sandbox", "allow-scripts");
  iframe.style.cssText = "width:600px;height:200px;border:1px solid #ccc;border-radius:12px";
  document.body.append(iframe);
  const bridge = new AppBridge(null, { name: "TestHost", version: "1.0.0" }, { openLinks: {}, logging: {}, message: { text: {} }, updateModelContext: { text: {} }, ...(serverTools ? { serverTools: {} } : {}) }, {
    hostContext: { theme, platform: "web", displayMode: "inline", ...(styles ? { styles: { variables: styles as unknown as McpUiStyles } } : {}) },
  });
  const messages: string[] = [];
  const sizes: number[] = [];
  const calls: Array<{ name: string; arguments: Record<string, unknown> }> = [];
  if (serverTools) {
    bridge.oncalltool = async (params) => {
      calls.push({ name: params.name, arguments: params.arguments ?? {} });
      if (!window.callServer) throw new Error("no server");
      return window.callServer(params.name, params.arguments ?? {});
    };
  }
  bridge.onmessage = async ({ content }) => {
    for (const c of content) if (c.type === "text") messages.push(c.text);
    return {};
  };
  bridge.addEventListener("sizechange", ({ height }) => {
    if (typeof height === "number") { iframe.style.height = `${height}px`; sizes.push(height); }
  });
  const ready = new Promise<void>((done) => { bridge.oninitialized = () => done(); });
  iframe.srcdoc = html;
  void bridge.connect(new PostMessageTransport(iframe.contentWindow!, iframe.contentWindow!));
  window.host = { ready, bridge, messages, sizes, calls };
}
