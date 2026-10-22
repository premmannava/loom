---
title: In Claude, ChatGPT and other chat apps
description: The SayShape MCP server shows SayShape interfaces inside chat apps that support MCP Apps.
---

# In Claude, ChatGPT and other chat apps

The SayShape MCP server lets a chat app's own model show SayShape interfaces **inside the conversation**. It's an [MCP Apps](https://modelcontextprotocol.io/docs/extensions/apps) server, so it works in chat apps that support MCP Apps, such as Claude, ChatGPT, VS Code and Goose. Support differs between apps and versions.

You don't need your own model or API key: the chat app's model writes the spec, and SayShape's engine draws it in the chat.

## How it works

1. The model calls `sayshape_guide` once to learn the language. The guide is generated from the same component definitions the engine renders with.
2. It calls `show_interface` with a spec. The server checks the spec with SayShape's parser and tells the model which lines it skipped, with line numbers, so it can fix them.
3. The chat app shows the server's view: the SayShape engine in one self-contained HTML file. In apps that stream tool input, the interface builds line by line while the model writes.
4. When someone presses a button with `on=emit:name`, the view sends a message into the conversation with the action, its value and the interface's current values, and the model can respond.

Nothing else leaves an interface. A spec can't run code, open links or make requests, and the chat app's sandbox around the view is a second layer, not the first.

## Install

You need Node.js 20 or later. Add the server to your chat app's MCP settings, and the app runs it with `npx`. In Claude Desktop that's Settings → Developer → Edit Config:

```json
{
  "mcpServers": {
    "sayshape": { "command": "npx", "args": ["-y", "sayshape-mcp"] }
  }
}
```

Then restart the app. The [server's README](https://github.com/premmannava/sayshape/tree/main/mcp#readme) has the settings for VS Code and for apps that connect to a URL, and how to run it from source.

## Compared with the website

The [Build with AI](/chat) page uses a free hosted model through a proxy with a small daily limit. The MCP server uses the model you already chat with, so its results depend on that model, and there's no shared limit.
