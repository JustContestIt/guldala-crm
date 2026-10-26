// The only place the CRM talks to OpenAI (spec §19). services/assistant.ts calls the model through `respond`; tests pass a fake.
import OpenAI from "openai";
import { toResponseInputItems } from "openai/lib/responses/ResponseInputItems";
import type { ResponseInputItem } from "openai/resources/responses/responses";

export type Tool = { name: string; description: string; parameters: Record<string, unknown> };
export type ModelCall = { callId: string; name: string; arguments: string };
export type ModelRequest = { model: string; effort: Effort; instructions: string; input: ResponseInputItem[]; tools: Tool[] };
// items go back as input next step; reasoning (the model's own summary, in English) and usage go to the run journal
export type ModelReply = { text: string; calls: ModelCall[]; items: ResponseInputItem[]; reasoning?: string; usage?: { in: number; cached: number; out: number } };
export type Model = (r: ModelRequest) => Promise<ModelReply>;

// "" = the model's own default; gpt-4o and gpt-4.1 don't reason at all and take only that
export const EFFORTS = ["", "none", "minimal", "low", "medium", "high", "xhigh", "max"] as const;
export type Effort = (typeof EFFORTS)[number];

// OpenAI's cheapest current model with function calling (developers.openai.com/api/docs/models, 24.10.2026)
export const DEFAULT_MODEL = "gpt-6-luna";
export const DEFAULT_EFFORT: Effort = "low";

let client: OpenAI | undefined;
const openai = () => (client ??= new OpenAI({ timeout: 60_000, maxRetries: 1 })); // OPENAI_API_KEY; one retry on network errors, 429 and 5xx, as wazzup.ts

export const respond: Model = async ({ model, effort, instructions, input, tools }) => {
  const started = Date.now();
  const r = await openai().responses.create({
    model,
    instructions, // first and the same on every call: OpenAI caches a repeated prompt start by itself
    input,
    ...(tools.length ? { tools: tools.map((t) => ({ type: "function" as const, strict: true, ...t })) } : {}),
    ...(effort && { reasoning: { effort, summary: "detailed" as const } }), // «auto» gives gpt-6-luna/low no summary at all (26.10.2026)
    store: false, // the clients' messages don't stay at OpenAI; reasoning comes back encrypted in the items
  });
  const calls = r.output.flatMap((o) => (o.type === "function_call" ? [{ callId: o.call_id, name: o.name, arguments: o.arguments }] : []));
  const u = r.usage;
  console.log(
    `[openai] ${model}${effort ? `/${effort}` : ""} ${Date.now() - started} ms ${r.status}, tokens in ${u?.input_tokens} (cached ${u?.input_tokens_details.cached_tokens}) out ${u?.output_tokens}, tools: ${calls.map((c) => c.name).join(", ") || "—"}`,
  );
  return {
    text: r.output_text,
    calls,
    items: toResponseInputItems(r.output),
    reasoning: r.output.flatMap((o) => (o.type === "reasoning" ? o.summary.map((s) => s.text) : [])).join("\n\n"),
    usage: u && { in: u.input_tokens, cached: u.input_tokens_details.cached_tokens, out: u.output_tokens },
  };
};

// Chat models for the assistant: text in and out with function calling. No dated snapshots, audio, voice, images,
// search, embeddings, «pro», old gpt-3.5 / gpt-4, and none past their shutdown date (the rest keep it to show).
export function chatModels(list: { id: string; shutdown_date?: string | null }[], today: string) {
  return list
    .filter(
      (m) =>
        /^(gpt-|o\d)/.test(m.id) &&
        !/^gpt-(3|4(-|$))/.test(m.id) &&
        !/audio|realtime|live|transcribe|tts|search|image|embedding|moderation|instruct|codex|computer|research|oss|chat-latest|preview|-pro\b|-\d{4}(-\d{2}-\d{2})?$/.test(m.id) &&
        !(m.shutdown_date && m.shutdown_date <= today),
    )
    .map((m) => ({ id: m.id, shutdown: m.shutdown_date ?? null }))
    .sort((a, b) => a.id.localeCompare(b.id));
}

export async function listModels(today: string) {
  const all = [];
  for await (const m of openai().models.list()) all.push(m);
  return chatModels(all, today);
}

// $ per 1M tokens, input / output (developers.openai.com/api/docs/pricing, 24.10.2026): a hint next to the name, not a bill
export const PRICES: Record<string, string> = {
  "gpt-6-astra": "10 / 50",
  "gpt-6.1-sol": "2 / 10",
  "gpt-6-sol": "2 / 10",
  "gpt-6-luna": "0,10 / 0,50",
  "gpt-5.6-sol": "4 / 20",
  "gpt-5.6-terra": "2 / 12",
  "gpt-5.6-luna": "0,20 / 1,20",
  "gpt-5.5": "5 / 30",
  "gpt-5.4": "2,50 / 15",
  "gpt-5.4-mini": "0,75 / 4,50",
  "gpt-5.4-nano": "0,20 / 1,25",
  "gpt-5.2": "1,75 / 14",
  "gpt-5.1": "1,25 / 10",
  "gpt-5": "1,25 / 10",
  "gpt-5-mini": "0,25 / 2",
  "gpt-5-nano": "0,05 / 0,40",
  "gpt-4.1": "2 / 8",
  "gpt-4.1-mini": "0,40 / 1,60",
  "gpt-4.1-nano": "0,10 / 0,40",
  "gpt-4o": "2,50 / 10",
  "gpt-4o-mini": "0,15 / 0,60",
  o3: "2 / 8",
  "o3-mini": "1,10 / 4,40",
  "o4-mini": "1,10 / 4,40",
};
