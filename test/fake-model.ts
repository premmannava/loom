/** A fake OpenAI-compatible server for the model tests. */
import type { ChatMessage } from "../src/model";

export interface Reply {
  /** Content chunks, streamed in order. */
  content: string[];
  /** Reasoning chunks sent in a separate field first, as some servers do. */
  reasoning?: string[];
  usage?: { prompt_tokens?: number; completion_tokens?: number; completion_tokens_details?: { reasoning_tokens: number } };
}

/** A fake OpenAI-compatible server: each request gets the next reply, as server-sent events split at odd places. */
export function fakeModel(replies: Reply[]) {
  const requests: Array<{ url: string; headers: Record<string, string>; body: { model: string; messages: ChatMessage[]; stream: boolean; stream_options?: unknown } }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    requests.push({ url, headers: init.headers as Record<string, string>, body: JSON.parse(init.body as string) });
    const reply = replies[requests.length - 1];
    if (!reply) return new Response("no more replies", { status: 500 });
    const events = [
      ...(reply.reasoning ?? []).map((t) => ({ choices: [{ delta: { reasoning_content: t } }] })),
      ...reply.content.map((t) => ({ choices: [{ delta: { content: t } }] })),
      ...(reply.usage ? [{ choices: [], usage: reply.usage }] : []),
    ];
    const sse = events.map((e) => `data: ${JSON.stringify(e)}\n\n`).join("") + "data: [DONE]\n\n";
    // Deliver in 7-byte pieces so events and lines are split across reads.
    const bytes = new TextEncoder().encode(sse);
    const body = new ReadableStream<Uint8Array>({
      start(c) {
        for (let i = 0; i < bytes.length; i += 7) c.enqueue(bytes.slice(i, i + 7));
        c.close();
      },
    });
    return new Response(body, { status: 200, headers: { "Content-Type": "text/event-stream" } });
  }) as typeof fetch;
  return { fetch: fetchImpl, requests };
}

