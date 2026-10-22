/** Cloudflare Worker entry point. The logic is in handler.ts. */
import { handle, type Env } from "./handler";

export default {
  fetch(req: Request, env: Env, ctx: { waitUntil(p: Promise<unknown>): void }): Promise<Response> {
    return handle(req, env, { waitUntil: (p) => ctx.waitUntil(p) });
  },
};
