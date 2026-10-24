// The only door to messengers (spec §12): UI and services never see HTTP
import { wazzup } from "./wazzup";

export type OutMessage = { chatId: string; text: string; crmMessageId: string };

// A webhook as the CRM sees it, whatever the provider
export type InMessage = {
  messageId: string;
  channelId: string;
  chatId: string; // WhatsApp: the phone, digits only
  type: string; // text, image, audio, …
  text: string; // a placeholder like «[фото]» when there is no text
  attachments: { type: string; uri: string }[];
  isEcho: boolean; // outgoing: through the API, from Tatiana's phone or from Wazzup's chat
};
export type Webhook = {
  test: boolean;
  messages: InMessage[];
  statuses: { messageId: string; status: "sent" | "delivered" | "read" | "error"; error: string | null }[];
  channels: { channelId: string; state: string }[];
};

export interface MessagingProvider {
  name: string;
  send(m: OutMessage): Promise<{ messageId: string }>;
  channelStatus(): Promise<{ state: string; phone: string | null }>;
  subscribe(uri: string): Promise<string>; // the webhook address the provider has after subscribing
}

// Dev and tests without network: logs and pretends the message left
export const fakeProvider: MessagingProvider = {
  name: "fake",
  async send(m) {
    console.log(`[messaging:fake] → ${m.chatId}: ${m.text.replace(/\n/g, " | ")}`);
    return { messageId: `fake-${m.crmMessageId}` };
  },
  async channelStatus() {
    return { state: "active", phone: null };
  },
  async subscribe(uri) {
    console.log(`[messaging:fake] webhooks → ${uri}`);
    return uri;
  },
};

// Wazzup channel states (GET /v3/channels, channelsUpdates webhook) in Tatiana's words
export const CHANNEL_STATE: Record<string, string> = {
  active: "работает",
  init: "запускается",
  disabled: "выключен в Wazzup",
  phoneUnavailable: "нет связи с телефоном",
  qr: "нужно отсканировать QR-код",
  qridle: "нужно отсканировать QR-код",
  openElsewhere: "WhatsApp открыт в другом месте",
  openelsewhere: "канал подключён в другом аккаунте Wazzup",
  notEnoughMoney: "канал не оплачен",
  unauthorized: "нужно заново подключить канал",
  foreignphone: "QR-код отсканирован с другого номера",
  waitForPassword: "нужен пароль двухфакторной защиты",
  blocked: "канал заблокирован",
  not_found: "канал не найден — проверьте WAZZUP_CHANNEL_ID",
};

const testPhones = () =>
  (process.env.WAZZUP_TEST_PHONES ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

// While WAZZUP_TEST_PHONES is set ("+7…,+7…"), the CRM deals only with those chats: nothing is sent to anyone else,
// and nothing from anyone else is stored, answered or shown to the model. Sending and receiving share this check.
export function chatAllowed(chatId: string) {
  const phones = testPhones();
  return !phones.length || phones.includes(`+${chatId}`);
}

// Other numbers fail and land in the journal as not sent
export function testOnly(p: MessagingProvider): MessagingProvider {
  return {
    ...p,
    async send(m) {
      if (chatAllowed(m.chatId)) return p.send(m);
      console.log(`[messaging] → ${m.chatId}: пропущено, не тестовый номер`);
      throw new Error("пропущено, не тестовый номер (WAZZUP_TEST_PHONES)");
    },
  };
}

export function messaging(): MessagingProvider {
  const p = process.env.WAZZUP_API_TOKEN ? wazzup : fakeProvider;
  return testPhones().length ? testOnly(p) : p;
}
