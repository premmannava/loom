/**
 * Imported first by main.ts, before anything that defines zod schemas.
 * zod (used by the MCP Apps bridge) probes whether it may compile parsers with
 * new Function(""). Chat apps run the view in a sandbox whose Content Security
 * Policy forbids that, so the probe fails and the host logs a CSP violation for
 * every interface. jitless tells zod not to try. SayShape itself never uses eval.
 */
import { config } from "zod";

config({ jitless: true });
