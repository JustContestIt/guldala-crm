// The only place the CRM calls OpenAI (spec §19). services/assistant.ts goes through `respond`; tests pass a fake.
import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type { ResponseInputItem } from "openai/resources/responses/responses";

export type Tool = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelCall = { callId: string; name: string; arguments: string };
export type ModelRequest = { instructions: string; input: ResponseInputItem[]; tools: Tool[] };
export type ModelReply = { text: string; calls: ModelCall[]; items: ResponseInputItem[] }; // items go back as input next step
export type Model = (r: ModelRequest) => Promise<ModelReply>;

// OpenAI's mid-priced model with function calling (developers.openai.com/api/docs/models, 24.10.2026); OPENAI_MODEL overrides
const DEFAULT_MODEL = "gpt-6.1-sol";

let client: OpenAI | undefined;

export const respond: Model = async ({ instructions, input, tools }) => {
  client ??= new OpenAI({ timeout: 60_000, maxRetries: 1 }); // OPENAI_API_KEY; one retry on network errors, 429 and 5xx, as wazzup.ts
  const model = process.env.OPENAI_MODEL || DEFAULT_MODEL;
  const started = Date.now();
  const r = await client.responses.create({
    model,
    instructions, // first and the same on every call: OpenAI caches a repeated prompt start by itself
    input,
    tools: tools.map((t) => ({ type: "function" as const, strict: true, ...t })),
    reasoning: { effort: "low" }, // a chat reply: the client shouldn't wait for deep thought
    store: false, // the clients' messages don't stay at OpenAI; reasoning comes back encrypted in the items
  });
  const calls = r.output.flatMap((o) => (o.type === "function_call" ? [{ callId: o.call_id, name: o.name, arguments: o.arguments }] : []));
  const u = r.usage;
  console.log(
    `[openai] ${model} ${Date.now() - started} ms ${r.status}, tokens in ${u?.input_tokens} (cached ${u?.input_tokens_details.cached_tokens}) out ${u?.output_tokens}, tools: ${calls.map((c) => c.name).join(", ") || "—"}`,
  );
  return { text: r.output_text, calls, items: toResponseInputItems(r.output) };
};
