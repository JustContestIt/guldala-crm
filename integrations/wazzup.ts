// Wazzup API v3 (wazzup24.ru/help/api-ru/): sending, channel status, webhook subscription and the webhook body
import { obj, str } from "@/lib/json";
import type { InMessage, MessagingProvider, Webhook } from "./messaging";

const BASE = "https://api.wazzup24.com/v3";

// Error codes of POST /v3/message, webhook subscription and status webhooks in Tatiana's words
const ERRORS: Record<string, string> = {
  CHANNEL_NOT_FOUND: "канал WhatsApp не найден в Wazzup — проверьте WAZZUP_CHANNEL_ID",
  CHANNEL_BLOCKED: "канал WhatsApp выключен в Wazzup",
  CHANNEL_NO_MONEY: "канал WhatsApp не оплачен в Wazzup",
  MESSAGE_CHANNEL_UNAVAILABLE: "телефон с WhatsApp не в сети",
  CHANNEL_LIMIT_EXCEEDED: "у канала закончился лимит диалогов в Wazzup",
  BAD_CONTACT: "этого номера нет в WhatsApp",
  MESSAGES_IS_SPAM: "WhatsApp счёл сообщение спамом",
  SPAM: "WhatsApp счёл сообщение спамом",
  MESSAGE_TEXT_TOO_LONG: "текст длиннее 10 000 знаков",
  MESSAGE_NOTHING_TO_SEND: "пустое сообщение",
  MESSAGES_TEXT_CAN_NOT_BE_BLANK: "пустое сообщение",
  CHAT_NO_ACCESS: "нет доступа к этому чату в Wazzup",
  VALIDATION_ERROR: "Wazzup не принял данные сообщения",
  INVALID_MESSAGE_DATA: "Wazzup не принял данные сообщения",
  REPEATED_CRM_MESSAGE_ID: "это сообщение уже отправлено меньше минуты назад",
  uriNotValid: "Wazzup не принял адрес вебхука",
  testPostNotPassed: "Wazzup не достучался до адреса вебхука",
};

export const wazzupError = (code: string) => ERRORS[code] ?? `ошибка Wazzup ${code}`;

const json = (s: string): unknown => {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
};
const list = (v: unknown) => (Array.isArray(v) ? v.map(obj) : []);

async function call(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<unknown> {
  // one retry on network errors and 5xx; crmMessageId makes a repeated send safe on Wazzup's side
  for (let attempt = 1; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(BASE + path, {
        method,
        headers: { Authorization: `Bearer ${process.env.WAZZUP_API_TOKEN}`, "Content-Type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
    } catch (e) {
      console.error(`[wazzup] ${method} ${path} attempt ${attempt}: ${e}`);
      if (attempt < 2) continue;
      throw new Error("Wazzup не отвечает");
    }
    const text = await res.text();
    console.log(`[wazzup] ${method} ${path} → ${res.status} ${text.slice(0, 300)}`);
    if (res.ok) return json(text);
    const code = str(obj(json(text)).error);
    // the retry hit Wazzup's 60 s crmMessageId dedup: the first attempt was delivered, its answer got lost
    if (attempt > 1 && code === "REPEATED_CRM_MESSAGE_ID") return {};
    if (res.status >= 500 && attempt < 2) continue;
    if (res.status === 401) throw new Error("Wazzup не принял ключ API — проверьте WAZZUP_API_TOKEN");
    if (res.status === 429) throw new Error("Wazzup просит подождать: слишком много запросов");
    throw new Error(code ? wazzupError(code) : `Wazzup ответил ${res.status}`);
  }
}

export const wazzup: MessagingProvider = {
  name: "wazzup",
  async send(m) {
    const r = obj(
      await call("POST", "/message", {
        channelId: process.env.WAZZUP_CHANNEL_ID,
        chatType: "whatsapp",
        chatId: m.chatId,
        text: m.text,
        crmMessageId: m.crmMessageId,
      }),
    );
    return { messageId: str(r.messageId) };
  },
  async channelStatus() {
    const ch = list(await call("GET", "/channels")).find((c) => c.channelId === process.env.WAZZUP_CHANNEL_ID);
    return ch ? { state: str(ch.state), phone: str(ch.plainId) ? `+${str(ch.plainId)}` : null } : { state: "not_found", phone: null };
  },
  // Wazzup posts {test: true} to the address before saving it; deals and contacts stay off (they want answers we don't give)
  async subscribe(uri) {
    await call("PATCH", "/webhooks", {
      webhooksUri: uri,
      subscriptions: { messagesAndStatuses: true, channelsUpdates: true, contactsAndDealsCreation: false, templateStatus: false },
    });
    return str(obj(await call("GET", "/webhooks")).webhooksUri);
  },
};

const PLACEHOLDER: Record<string, string> = {
  image: "[фото]",
  audio: "[голосовое сообщение]",
  video: "[видео]",
  document: "[файл]",
  vcard: "[контакт]",
  geo: "[геолокация]",
  missing_call: "[пропущенный звонок]",
};
const STATUSES = ["sent", "delivered", "read", "error"] as const;

// POST /webhooks/wazzup/<secret>: messages, statuses and channel updates, any of them in one body. Only WhatsApp chats
// with a phone as chatId. shortcut: edits and deletions repeat a messageId and are dropped as repeats; show them if Tatiana asks.
export function handleWebhook(body: unknown): Webhook {
  const b = obj(body);
  return {
    test: b.test === true,
    messages: list(b.messages)
      .filter((m) => m.chatType === "whatsapp" && /^\d{10,15}$/.test(str(m.chatId)) && str(m.messageId))
      .map((m): InMessage => {
        const type = str(m.type) || "text";
        return {
          messageId: str(m.messageId),
          channelId: str(m.channelId),
          chatId: str(m.chatId),
          type,
          text: str(m.text, 10_000) || PLACEHOLDER[type] || `[${type}]`,
          attachments: str(m.contentUri, 2000) ? [{ type, uri: str(m.contentUri, 2000) }] : [],
          isEcho: m.isEcho === true,
        };
      }),
    statuses: list(b.statuses).flatMap((x) => {
      const status = STATUSES.find((s) => s === x.status);
      const code = str(obj(x.error).error);
      return status && str(x.messageId)
        ? [{ messageId: str(x.messageId), status, error: status === "error" ? (code ? wazzupError(code) : "не доставлено") : null }]
        : [];
    }),
    channels: list(b.channelsUpdates)
      .filter((c) => str(c.channelId) && str(c.state))
      .map((c) => ({ channelId: str(c.channelId), state: str(c.state) })),
  };
}
