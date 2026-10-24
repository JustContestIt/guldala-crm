// Integration: Wazzup webhooks against real Postgres (TEST_DATABASE_URL), fake messaging provider
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeProvider, type MessagingProvider } from "@/integrations/messaging";
import { handleWebhook } from "@/integrations/wazzup";

const enabled = !!process.env.TEST_DATABASE_URL;
const CH = "channel-test";
const PHONE = "77018884446";

const wa = (messageId: string, text: string, extra: object = {}) => ({ messageId, channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text, isEcho: false, ...extra });

describe.skipIf(!enabled)("Wazzup webhooks", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const msg = await import("./messages");
  const receive = (body: object) => msg.receiveWebhook(handleWebhook(body));
  const sendAs = (messageId: string): MessagingProvider => ({ ...fakeProvider, send: async () => ({ messageId }) });

  beforeEach(async () => {
    await db.execute(sql`truncate clients, conversations, messages, app_state, orders, order_events cascade`);
    vi.stubEnv("WAZZUP_CHANNEL_ID", CH);
    vi.stubEnv("WAZZUP_TEST_PHONES", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("stores a message once however often the webhook repeats, and creates the unknown client", async () => {
    expect(await receive({ messages: [wa("w1", "Здравствуйте")] })).toHaveLength(1);
    expect(await receive({ messages: [wa("w1", "Здравствуйте")] })).toEqual([]); // nothing new for the assistant either
    const rows = await db.select().from(s.messages);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ direction: "in", author: "client", text: "Здравствуйте", externalMessageId: "w1" });
    const [client] = await db.select().from(s.clients);
    expect(client).toMatchObject({ phone: `+${PHONE}`, source: "inbound_message", name: "" });
    const [conv] = await db.select().from(s.conversations);
    expect(conv.lastInboundAt).not.toBeNull();
  });

  it("skips the echo of a message the CRM sent, also when the echo overtakes Wazzup's answer", async () => {
    // the echo webhook lands while the send is still waiting for Wazzup: the row has no messageId yet
    const racing: MessagingProvider = {
      ...fakeProvider,
      send: async (m) => {
        await receive({ messages: [wa("w-race", m.text, { isEcho: true })] });
        return { messageId: "w-race" };
      },
    };
    expect((await msg.sendMessage({ phone: `+${PHONE}`, text: "Заказ T-2027-0001 принят", templateKey: "booking" }, null, racing)).ok).toBe(true);
    await msg.sendMessage({ phone: `+${PHONE}`, text: "Ещё одно", templateKey: null }, null, sendAs("w-2"));
    await receive({ messages: [wa("w-2", "Ещё одно", { isEcho: true })] });

    const rows = await db.select().from(s.messages).orderBy(asc(s.messages.createdAt));
    expect(rows.map((m) => [m.text, m.author, m.isEcho, m.externalMessageId, m.status])).toEqual([
      ["Заказ T-2027-0001 принят", "system", false, "w-race", "sent"],
      ["Ещё одно", "system", false, "w-2", "sent"],
    ]);
    const [conv] = await db.select().from(s.conversations);
    expect(conv.assistantMutedAt).toBeNull();
  });

  it("writes Tatiana's reply from the phone as the operator's echo and mutes the bot", async () => {
    await receive({ messages: [wa("w1", "Здравствуйте")] });
    expect(await receive({ messages: [wa("w2", "Добрый день! Сейчас посчитаю", { isEcho: true })] })).toEqual([]);
    const [echo] = await db.select().from(s.messages).where(eq(s.messages.externalMessageId, "w2"));
    expect(echo).toMatchObject({ direction: "out", author: "operator", isEcho: true });
    const [conv] = await db.select().from(s.conversations);
    expect(conv.assistantMutedAt).not.toBeNull();
  });

  it("moves statuses forward only and explains errors in words", async () => {
    await msg.sendMessage({ phone: `+${PHONE}`, text: "a", templateKey: null }, null, sendAs("s1"));
    await msg.sendMessage({ phone: `+${PHONE}`, text: "b", templateKey: null }, null, sendAs("s2"));
    await receive({ statuses: [{ messageId: "s1", status: "read" }, { messageId: "s1", status: "delivered" }, { messageId: "s2", status: "error", error: { error: "BAD_CONTACT" } }] });
    const rows = await db.select().from(s.messages).orderBy(asc(s.messages.createdAt));
    expect(rows.map((m) => [m.text, m.status, m.error])).toEqual([
      ["a", "read", null],
      ["b", "error", "этого номера нет в WhatsApp"],
    ]);
    expect(rows[0].readAt).not.toBeNull();
  });

  it("keeps the channel state and the time of the last webhook", async () => {
    await receive({ channelsUpdates: [{ channelId: CH, state: "phoneUnavailable" }, { channelId: "someone-else", state: "active" }] });
    const info = await msg.channelInfo();
    expect(info.state).toBe("phoneUnavailable");
    expect(info.webhookAt).not.toBeNull();
  });

  it("ignores other people's chats and other channels while WAZZUP_TEST_PHONES is set", async () => {
    vi.stubEnv("WAZZUP_TEST_PHONES", `+${PHONE}`);
    const fresh = await receive({
      messages: [
        wa("x1", "личное", { chatId: "77770000001" }),
        wa("x2", "ответ с телефона", { chatId: "77770000001", isEcho: true }),
        wa("x3", "другой канал", { channelId: "someone-else" }),
        wa("x4", "тест"),
      ],
    });
    expect(fresh).toHaveLength(1);
    expect((await db.select().from(s.messages)).map((m) => m.text)).toEqual(["тест"]);
    expect((await db.select().from(s.clients)).map((c) => c.phone)).toEqual([`+${PHONE}`]);
  });

  it("answers Wazzup's test post and hides from a wrong secret", async () => {
    vi.stubEnv("WAZZUP_WEBHOOK_SECRET", "s3cret");
    const { POST } = await import("@/app/webhooks/wazzup/[secret]/route");
    const post = (secret: string) => POST(new Request("http://crm/webhooks", { method: "POST", body: JSON.stringify({ test: true }) }), { params: Promise.resolve({ secret }) });
    expect((await post("s3cret")).status).toBe(200);
    expect((await post("wrong")).status).toBe(404);
  });
});
