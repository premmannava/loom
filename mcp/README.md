# SayShape MCP server

Lets AI chat apps show SayShape interfaces **inside the conversation**. Ask a question, and instead of a wall of text the assistant answers with a working card, table, chart, form or calculator. SayShape's engine draws it on a canvas, right in the chat.

It's an [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server, so it works in any chat app that supports MCP Apps, such as Claude, ChatGPT, VS Code and Goose. Support differs between apps and versions.

```
you: "Compare the three phone plans I pasted"
  └─ model calls sayshape_guide (once), then show_interface with a spec
       └─ the chat app shows the view: SayShape's engine draws the spec
            └─ you press a button with on=emit:… → it arrives back as a message
```

## What it offers

| | |
|---|---|
| `sayshape_guide` | The language guide, generated from the same component definitions the engine renders with. The model reads it once per conversation. |
| `show_interface` | Takes a spec (and an optional title), checks it with SayShape's own parser and returns any skipped lines with line numbers, so the model can fix them. The chat app shows the result in the view. |
| `ui://sayshape/interface.html` | The view: the SayShape engine, the Instrument Sans font and a small bridge script, all in one HTML file. It loads nothing from anywhere else. |

In chat apps that stream tool input, the interface builds line by line while the model is still writing it. When the person presses a button with `on=emit:name`, the view sends a message into the conversation naming the action, its value and the interface's current values. The model can then reply or show an updated interface. That's the only way anything leaves an interface: specs can't run code, open links or make requests.

## Install

The package isn't on npm yet, so build it from the repository (Node 20 or later):

```bash
git clone https://github.com/premmannava/sayshape.git
cd sayshape/mcp
npm ci
npm run build          # dist/server.js and dist/ui.html
```

Then add it to your chat app. Use the full path to `dist/server.js`.

**Claude Desktop:** Settings → Developer → Edit Config, then add:

```json
{
  "mcpServers": {
    "sayshape": { "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js"] }
  }
}
```

Restart Claude Desktop.

**VS Code:** in `.vscode/mcp.json`:

```json
{
  "servers": {
    "sayshape": { "type": "stdio", "command": "node", "args": ["/full/path/to/sayshape/mcp/dist/server.js"] }
  }
}
```

**Apps that connect to a URL** (custom connectors in Claude on the web, ChatGPT developer mode): run it over HTTP and put it behind HTTPS (a reverse proxy or a tunnel). It listens only on 127.0.0.1:

```bash
node dist/server.js --http 3001    # http://127.0.0.1:3001/mcp
```

Then ask for something visual: *"Show the 2022 World Cup final as a stat card"*, or *"Make me a tip calculator for $86 split three ways"*.

## Development

```bash
npm test           # server and helpers, against an in-memory MCP client
npm run typecheck
npm run build
npm run test:e2e   # the built view in Chromium, inside a sandboxed iframe driven by the MCP Apps host bridge
```

`test:e2e` streams a spec into the view, checks the canvas was painted and the height reported, presses an `emit:` button with the keyboard, checks the message that comes back and switches to dark mode. Its screenshots go to `e2e-output/`.

The server bundles the engine from `../src`, so the guide, the parser and the view always match the library they were built with. The MCP packages (`@modelcontextprotocol/sdk`, `@modelcontextprotocol/ext-apps`, `zod`) are dependencies of this package only. The SayShape library itself still has none.
