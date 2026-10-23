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

export const messaging = (): MessagingProvider => (process.env.WAZZUP_API_TOKEN ? wazzup : fakeProvider);
