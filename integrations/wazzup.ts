// Wazzup API v3 (wazzup24.com/help/api-en/). Only sending for now; webhooks arrive at stage 5.
import type { MessagingProvider } from "./messaging";

const BASE = "https://api.wazzup24.com/v3";

async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
  // one retry on network errors and 5xx; crmMessageId makes the repeat safe on Wazzup's side
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        method: "POST",
        headers: { Authorization: `Bearer ${process.env.WAZZUP_API_TOKEN}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      console.error(`[wazzup] POST ${path} attempt ${attempt}: ${e}`);
      if (attempt < 2) continue;
      throw new Error("Wazzup не отвечает");
    }
    const text = await res.text();
    console.log(`[wazzup] POST ${path} → ${res.status} ${text.slice(0, 300)}`);
    if (res.ok) return text ? JSON.parse(text) : {};
    if (res.status >= 500 && attempt < 2) continue;
    throw new Error(`Wazzup ${res.status}: ${text.slice(0, 200)}`);
  }
}

export const wazzup: MessagingProvider = {
  name: "wazzup",
  async send(m) {
    const r = await post("/message", {
      channelId: process.env.WAZZUP_CHANNEL_ID,
      chatType: "whatsapp",
      chatId: m.chatId,
      text: m.text,
      crmMessageId: m.crmMessageId,
    });
    return { messageId: String(r.messageId ?? "") };
  },
};
