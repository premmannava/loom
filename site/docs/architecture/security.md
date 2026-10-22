---
title: The expression boundary
description: Why SayShape specs can't run code. The expression interpreter, frozen data, restricted images, and reviewed components.
---

# The expression boundary

A spec is written by a model, and a model's output can't be trusted to be harmless. SayShape's answer is that a spec isn't a program: there's no route from a spec to JavaScript.

## What an expression can do

Everything inside `{…}` goes through SayShape's own tokenizer, parser and evaluator in `src/expr.ts`. It can:

- read state and derived values by name, and fields and items of SayShape data;
- do arithmetic, comparisons and logic;
- call the functions on the [expressions page](../language/expressions#every-function), and no others.

It can't assign, call methods, read globals, construct objects or reach the host page. The function table is a frozen object with no prototype, looked up by own property only, so names like `constructor` reach nothing. `__proto__`, `constructor` and `prototype` can't be read as fields or used as names. Anything that can't be read shows as `—`.

The engine never uses `eval`, `new Function`, `with` or dynamic `import` for specs. The repository's expression tests include escape attempts, and its fuzz tests feed random and damaged specs, expressions and actions to check that nothing throws.

## Data stays data

State values are plain SayShape data: numbers, text, true/false, null, and lists and records that are frozen and have no prototype. Data your app passes in with `ui.state.set` is copied into that form; functions, class instances and cycles are refused. Literals in a spec are parsed as data, never run, and are limited in depth (20 levels) and size (10,000 values).

## Components are code you review

A spec can only use components registered with the engine. Components are TypeScript in the repository, reviewed like any other code. Nothing a model writes can register a component or run code. Specs can't set colors, fonts or sizes either, so a generated screen can't impersonate a different look.

## Effects go through your app

A spec can change its own state, move between its own screens and show a message. Anything with an effect outside the interface (saving, paying, sending, calling a model again) happens only because your app handled an `emit:` action. The one network request a spec can cause on its own is loading an image, and only from your origin or [hosts you allow](../integration/images).

## What this doesn't cover

These guarantees are about what a spec can make the engine do. They don't make a model's choices correct: a valid spec can still show a wrong total or a misleading label. Treat emitted values like any other user input on your server, and show people what they're confirming before acting on it.
