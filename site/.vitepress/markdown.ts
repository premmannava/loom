/**
 * Markdown support for live Loom examples.
 *
 *   ```loom live      highlighted source, with the spec rendered by the real engine beside it
 *   ```loom           highlighted source only
 *   ```loom invalid   source that is meant to produce diagnostics (skipped by the docs test)
 *
 * The spec is passed to the <LoomLive> component base64-encoded, so no
 * character in it can break out of the attribute or be read as markup.
 */
import type { MarkdownRenderer } from "vitepress";

const toBase64 = (text: string) => Buffer.from(text, "utf8").toString("base64");

export function loomLivePlugin(md: MarkdownRenderer): void {
  const fence = md.renderer.rules.fence!;
  md.renderer.rules.fence = (tokens, idx, options, env, self) => {
    const token = tokens[idx]!;
    const words = token.info.trim().split(/\s+/);
    if (words[0] !== "loom" || words.length === 1) return fence(tokens, idx, options, env, self);
    const live = words.includes("live");
    const invalid = words.includes("invalid");
    token.info = "loom";
    const code = fence(tokens, idx, options, env, self);
    if (!live && !invalid) return code;
    const spec = token.content.replace(/\n$/, "");
    return `<LoomLive spec="${toBase64(spec)}">${code}</LoomLive>\n`;
  };
}
