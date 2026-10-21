/**
 * Reads the model settings from .env.local (or the environment), for the
 * playground's dev server and the evaluation script. Never sent to a browser:
 * the playground reaches the model through the dev server's /api/model proxy.
 *
 *   LOOM_MODEL_URL    OpenAI-compatible base URL, up to /v1. Default: LM Studio, http://localhost:1234/v1
 *   LOOM_MODEL        Model name. Default: the playground lets you pick from the server's list.
 *   LOOM_API_KEY      Bearer token, if the server needs one.
 *   LOOM_USER_SUFFIX  Text added to every request, e.g. /no_think to stop Qwen3 thinking first.
 */
import { loadEnv } from "vite";

export interface ModelEnv {
  url: string;
  model: string;
  apiKey: string;
  userSuffix: string;
}

export const DEFAULT_MODEL_URL = "http://localhost:1234/v1";

export function readModelEnv(mode = "development", dir = process.cwd()): ModelEnv {
  const env = { ...loadEnv(mode, dir, "LOOM_"), ...pick(process.env) };
  return {
    url: (env.LOOM_MODEL_URL || DEFAULT_MODEL_URL).replace(/\/+$/, ""),
    model: env.LOOM_MODEL ?? "",
    apiKey: env.LOOM_API_KEY ?? "",
    userSuffix: env.LOOM_USER_SUFFIX ?? "",
  };
}

/** LOOM_ variables already in the environment win over the file. */
function pick(env: NodeJS.ProcessEnv): Record<string, string> {
  return Object.fromEntries(Object.entries(env).filter(([k, v]) => k.startsWith("LOOM_") && v !== undefined)) as Record<string, string>;
}
