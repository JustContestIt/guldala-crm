// Readers for JSON from outside (the site's bodies, Wazzup's webhooks, the model's tool arguments): text or a number until checked
export const str = (v: unknown, max = 200) => String(v ?? "").trim().slice(0, max);
export const num = (v: unknown) => (typeof v === "number" ? v : NaN);
export const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {});
