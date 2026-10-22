/**
 * Streams a chat completion from any OpenAI-compatible endpoint: OpenAI,
 * DeepSeek, OpenRouter, Gemini's compatibility API, and local servers such as
 * LM Studio, Ollama, vLLM and llama.cpp. Uses fetch only, so it runs in
 * browsers and in Node 18+.
 */

export interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface ModelConfig {
  /** Base URL up to and including /v1, e.g. http://localhost:1234/v1. A relative path (a dev-server proxy) works in browsers. */
  url: string;
  /** The model name the server knows, e.g. qwen3-14b. */
  model: string;
  /** Sent as a bearer token. Leave out for local servers that don't need one. */
  apiKey?: string;
  /** Default 0.2: SayShape is structured output, so little randomness helps. */
  temperature?: number;
  /** Default 4000. Reasoning models count their thinking here too. */
  maxTokens?: number;
  /** Extra headers, e.g. for a router's analytics. */
  headers?: Record<string, string>;
  /**
   * Ask the server to report token usage at the end of the stream
   * (stream_options.include_usage). Off by default: OpenAI, vLLM and recent
   * LM Studio and llama.cpp support it, but some servers reject the field.
   * Without it, usage is whatever the server sends on its own, or unknown.
   */
  streamUsage?: boolean;
}

export interface StreamPart {
  /** content is the answer; reasoning is thinking some servers send in a separate field. */
  kind: "content" | "reasoning";
  text: string;
}

/** Token counts as the server reported them. A missing field means unknown, never zero. */
export interface Usage {
  promptTokens?: number;
  completionTokens?: number;
  /** Thinking tokens, when reported (completion_tokens_details). Already counted in completionTokens. */
  reasoningTokens?: number;
}

export class ModelError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = "ModelError";
  }
}

type Fetch = typeof fetch;

interface ChunkJSON {
  choices?: Array<{ delta?: { content?: string | null; reasoning_content?: string | null; reasoning?: string | null } }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens?: number } | null } | null;
  error?: { message?: string } | string;
}

/** Stream the reply to some messages. The returned usage fills in when the server reports it. */
export async function* streamChat(
  config: ModelConfig,
  messages: ChatMessage[],
  opts: { signal?: AbortSignal; fetch?: Fetch; usage?: Usage } = {},
): AsyncGenerator<StreamPart> {
  const doFetch = opts.fetch ?? fetch;
  const url = config.url.replace(/\/+$/, "") + "/chat/completions";
  let res: Response;
  try {
    res = await doFetch(url, {
      method: "POST",
      signal: opts.signal,
      headers: {
        "Content-Type": "application/json",
        Accept: "text/event-stream",
        ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
        ...config.headers,
      },
      body: JSON.stringify({
        model: config.model,
        messages,
        stream: true,
        temperature: config.temperature ?? 0.2,
        max_tokens: config.maxTokens ?? 4000,
        ...(config.streamUsage ? { stream_options: { include_usage: true } } : {}),
      }),
    });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    throw new ModelError(`Couldn't reach the model at ${url}. Is the server running? (${e instanceof Error ? e.message : String(e)})`);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new ModelError(`The model server answered ${res.status} ${res.statusText}: ${body.slice(0, 300) || "(no details)"}`, res.status);
  }
  if (!res.body) throw new ModelError("The model server sent no response body");

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  try {
    for (;;) {
      const { done, value } = await reader.read();
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true });
      // Server-sent events: blocks separated by blank lines, payload on "data:" lines.
      let nl: number;
      while ((nl = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, nl).replace(/\r$/, "");
        buffer = buffer.slice(nl + 1);
        yield* parseLine(line, opts.usage);
      }
      if (done) {
        if (buffer.trim()) yield* parseLine(buffer, opts.usage);
        return;
      }
    }
  } finally {
    reader.releaseLock();
  }
}

function* parseLine(line: string, usage: Usage | undefined): Generator<StreamPart> {
  if (!line.startsWith("data:")) return;
  const data = line.slice(5).trim();
  if (!data || data === "[DONE]") return;
  let json: ChunkJSON;
  try { json = JSON.parse(data) as ChunkJSON; } catch { return; }
  if (json.error) {
    const msg = typeof json.error === "string" ? json.error : json.error.message ?? "unknown error";
    throw new ModelError(`The model server reported an error: ${msg}`);
  }
  if (json.usage && usage) {
    if (json.usage.prompt_tokens !== undefined) usage.promptTokens = json.usage.prompt_tokens;
    if (json.usage.completion_tokens !== undefined) usage.completionTokens = json.usage.completion_tokens;
    const reasoning = json.usage.completion_tokens_details?.reasoning_tokens;
    if (reasoning !== undefined) usage.reasoningTokens = reasoning;
  }
  const delta = json.choices?.[0]?.delta;
  if (!delta) return;
  const reasoning = delta.reasoning_content ?? delta.reasoning;
  if (reasoning) yield { kind: "reasoning", text: reasoning };
  if (delta.content) yield { kind: "content", text: delta.content };
}
