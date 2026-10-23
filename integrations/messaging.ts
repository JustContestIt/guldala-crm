// The only door to messengers (spec §12): UI and services never see HTTP. Webhooks and channel status — stage 5.
import { wazzup } from "./wazzup";

export type OutMessage = { chatId: string; text: string; crmMessageId: string };

export interface MessagingProvider {
  name: string;
  send(m: OutMessage): Promise<{ messageId: string }>;
}

// Dev and tests without network: logs and pretends the message left
export const fakeProvider: MessagingProvider = {
  name: "fake",
  async send(m) {
    console.log(`[messaging:fake] → ${m.chatId}: ${m.text.replace(/\n/g, " | ")}`);
    return { messageId: `fake-${m.crmMessageId}` };
  },
};

// While WAZZUP_TEST_PHONES is set ("+7…,+7…"), only those numbers get messages; the rest fail and land in the journal as not sent
export function testOnly(p: MessagingProvider, phones: string[]): MessagingProvider {
  return {
    name: p.name,
    async send(m) {
      if (phones.includes(`+${m.chatId}`)) return p.send(m);
      console.log(`[messaging] → ${m.chatId}: пропущено, не тестовый номер`);
      throw new Error("пропущено, не тестовый номер (WAZZUP_TEST_PHONES)");
    },
  };
}

export function messaging(): MessagingProvider {
  const p = process.env.WAZZUP_API_TOKEN ? wazzup : fakeProvider;
  const phones = (process.env.WAZZUP_TEST_PHONES ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  return phones.length ? testOnly(p, phones) : p;
}
