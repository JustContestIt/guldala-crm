// Integration: the WhatsApp assistant against real Postgres with a scripted fake model — no network
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeProvider, type MessagingProvider } from "@/integrations/messaging";
import type { Model, ModelRequest } from "@/integrations/openai";
import { handleWebhook } from "@/integrations/wazzup";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;
const CH = "channel-test";
const PHONE = "77018884446";

type Step = string | { name: string; args: object }[];

// Each model call takes the next step: text is the answer, a list is tool calls. `asked` keeps every request.
function script(...steps: Step[]) {
  const asked: ModelRequest[] = [];
  const model: Model = async (req) => {
    asked.push(structuredClone(req));
    const step = steps[asked.length - 1] ?? "";
    if (typeof step === "string") return { text: step, calls: [], items: [] };
    const calls = step.map((c, i) => ({ callId: `call-${asked.length}-${i}`, name: c.name, arguments: JSON.stringify(c.args) }));
    return { text: "", calls, items: calls.map((c) => ({ type: "function_call" as const, call_id: c.callId, name: c.name, arguments: c.arguments })) };
  };
  // what the tools of step N (1-based) answered, as the model saw it on the next request
  const outputs = (step: number) =>
    asked[step].input.flatMap((i) =>
      "type" in i && i.type === "function_call_output" && i.call_id?.startsWith(`call-${step}-`) && typeof i.output === "string" ? [JSON.parse(i.output)] : [],
    );
  return { model, asked, outputs };
}

const order = (extra: object = {}) => ({
  items: [{ color: "Розовый классический", packs: 4 }],
  prepaymentPct: 40,
  pickupDate: "2027-03-06",
  pickupTime: "10:00",
  pickupMethod: "self_pickup",
  storage: true,
  legalType: "ip",
  bin: null,
  orgName: null,
  comment: "Сорта: Strong Love",
  ...extra,
});

describe.skipIf(!enabled)("WhatsApp assistant", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const { receiveWebhook } = await import("./messages");
  const { assistantSettings, replyTo, saveAssistantSettings } = await import("./assistant");
  const { saveState } = await import("./settings");

  const sent: string[] = [];
  const provider: MessagingProvider = { ...fakeProvider, send: async (m) => (sent.push(m.text), { messageId: `w-out-${sent.length}` }) };
  let seq = 0;
  // the client writes; the webhook path stores it and the assistant answers what is new
  async function say(text: string, model: Model) {
    const fresh = await receiveWebhook(handleWebhook({ messages: [{ messageId: `w-in-${++seq}`, channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text }] }));
    for (const m of fresh) await replyTo(m, { model, provider, settleMs: 0 });
    return fresh;
  }
  const setMode = (mode: "off" | "draft" | "auto") => saveState("assistant", { mode, model: "test-model", effort: "" });
  const conversation = async () => (await db.select().from(s.conversations))[0];

  beforeEach(async () => {
    await db.execute(
      sql`truncate users, clients, seasons, products, price_rules, stock_plans, stock_adjustments, orders, order_items, payments, order_events, conversations, messages, app_state cascade`,
    );
    vi.stubEnv("OPENAI_API_KEY", "test");
    vi.stubEnv("WAZZUP_CHANNEL_ID", CH);
    vi.stubEnv("WAZZUP_TEST_PHONES", "");
    sent.length = 0;
    const [season] = await db
      .insert(s.seasons)
      .values({
        name: "Тюльпаны 2027",
        ordersOpenFrom: "2026-01-01",
        peakDate: "2027-03-08",
        pickupFrom: "2027-03-01",
        pickupTo: "2027-03-08",
        status: "open",
        settings: { ...DEFAULT_SETTINGS, peak_hours_from: "2027-03-05" },
      })
      .returning();
    const ps = await db
      .insert(s.products)
      .values([
        { name: "Красный классический", tulipType: "classic", color: "red" },
        { name: "Розовый классический", tulipType: "classic", color: "pink" },
      ])
      .returning();
    await db.insert(s.stockPlans).values(ps.map((p) => ({ seasonId: season.id, productId: p.id, plannedStems: 3000 })));
    await db.insert(s.priceRules).values([
      { seasonId: season.id, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-01-31", prepaymentMinPct: 40, prepaymentMaxPct: 90, pricePerStem: 200 },
      { seasonId: season.id, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-01-31", prepaymentMinPct: 100, prepaymentMaxPct: 100, pricePerStem: 180 },
      { seasonId: season.id, tulipType: "classic", dateFrom: "2027-02-01", dateTo: "2027-03-08", prepaymentMinPct: 40, prepaymentMaxPct: 100, pricePerStem: 250 },
    ]);
    await setMode("auto");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("«а скидка будет?» → handoff: the chat goes quiet, Tatiana gets a note, the client is told", async () => {
    const m = script([{ name: "handoff", args: { reason: "спрашивает про скидку" } }], "Передал ваш вопрос Татьяне, она ответит.");
    await say("а скидка будет?", m.model);
    expect(sent).toEqual(["Передал ваш вопрос Татьяне, она ответит."]);
    expect((await conversation()).assistantMutedAt).not.toBeNull();
    const [client] = await db.select().from(s.clients);
    expect(client.notes).toMatch(/бот передал Татьяне: спрашивает про скидку$/);
    const [reply] = await db.select().from(s.messages).where(eq(s.messages.author, "assistant"));
    expect(reply).toMatchObject({ status: "sent", direction: "out" });

    await say("алло?", m.model); // muted: no model call, no answer
    expect(m.asked).toHaveLength(2);
    expect(sent).toHaveLength(1);
  });

  it("«сколько красных?» → stock in words, never in numbers", async () => {
    const m = script([{ name: "stock_and_prices", args: {} }], "Красных много.");
    await say("сколько красных?", m.model);
    const [out] = m.outputs(1);
    expect(out.colors).toEqual([
      { color: "Красный классический", stock: "много" },
      { color: "Розовый классический", stock: "много" },
    ]);
    expect(JSON.stringify(out.colors)).not.toMatch(/\d/);
    expect(m.asked[0]).toMatchObject({ model: "test-model", effort: "" }); // what «Ещё → Ассистент» saved
    expect(out.pricePerStemToday.classic).toMatchObject({ "40%": 200, "100%": 180, until: "2027-01-31" });
    expect(sent).toEqual(["Красных много."]);
  });

  it("refuses to book without a pickup date, and books after «да» the way the site does", async () => {
    const noDate = script(
      [{ name: "update_client", args: { name: "Айгуль", company: "Цветы на Абая" } }],
      [{ name: "create_order", args: order({ pickupDate: null }) }],
      "На какую дату вывоза оформить?",
    );
    await say("4 пачки розовых, оформляйте", noDate.model);
    expect(noDate.outputs(2)[0].error).toMatch(/дата вывоза/);
    expect(await db.select().from(s.orders)).toEqual([]);

    const yes = script([{ name: "create_order", args: order() }], "Спасибо, Айгуль!");
    await say("да", yes.model);
    const [o] = await db.select().from(s.orders);
    expect(o).toMatchObject({ channel: "whatsapp", createdBy: "client", status: "confirmed", total: 24_000, storageRequested: true, commentClient: "Сорта: Strong Love" });
    expect(yes.outputs(1)[0]).toMatchObject({ orderNumber: o.number, total: 24_000, prepayment: 9_600 });
    const out = await db.select().from(s.messages).where(eq(s.messages.direction, "out")).orderBy(asc(s.messages.createdAt));
    expect(out.map((x) => [x.author, x.templateKey])).toEqual([
      ["assistant", null], // «На какую дату…»
      ["system", "booking"], // the same booking the site's order gets
      ["assistant", null],
    ]);
    const [client] = await db.select().from(s.clients);
    expect(client).toMatchObject({ name: "Айгуль", company: "Цветы на Абая" });
  });

  it("in draft mode keeps the answer for Tatiana and offers no create_order", async () => {
    await setMode("draft");
    const m = script("Здравствуйте! Сколько пачек нужно?");
    await say("Здравствуйте, хочу заказать", m.model);
    expect(sent).toEqual([]);
    const [draft] = await db.select().from(s.messages).where(eq(s.messages.author, "assistant"));
    expect(draft).toMatchObject({ status: "draft", text: "Здравствуйте! Сколько пачек нужно?" });
    expect(m.asked[0].tools.map((t) => t.name)).not.toContain("create_order");
  });

  it("stays quiet after Tatiana answers from her phone", async () => {
    const m = script("Здравствуйте!");
    const [first] = await receiveWebhook(handleWebhook({ messages: [{ messageId: "w-1", channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text: "Здравствуйте" }] }));
    await receiveWebhook(handleWebhook({ messages: [{ messageId: "w-2", channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text: "Добрый день!", isEcho: true }] }));
    await replyTo(first, { model: m.model, provider, settleMs: 0 });
    expect(m.asked).toHaveLength(0);
    expect(sent).toEqual([]);
  });

  it("answers a burst once, a repeated webhook never, and nothing without a key or with the mode off", async () => {
    const m = script("Здравствуйте! Чем помочь?");
    const fresh = await receiveWebhook(
      handleWebhook({
        messages: [
          { messageId: "b-1", channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text: "Здравствуйте" },
          { messageId: "b-2", channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text: "Есть красные?" },
        ],
      }),
    );
    await Promise.all(fresh.map((x) => replyTo(x, { model: m.model, provider, settleMs: 0 })));
    expect(m.asked).toHaveLength(1);
    expect(m.asked[0].input.slice(1)).toEqual([
      { role: "user", content: "Здравствуйте" },
      { role: "user", content: "Есть красные?" },
    ]);
    expect(await receiveWebhook(handleWebhook({ messages: [{ messageId: "b-2", channelId: CH, chatType: "whatsapp", chatId: PHONE, type: "text", text: "Есть красные?" }] }))).toEqual([]);

    vi.stubEnv("OPENAI_API_KEY", "");
    await say("ау", m.model);
    await setMode("off");
    vi.stubEnv("OPENAI_API_KEY", "test");
    await say("ау?", m.model);
    expect(m.asked).toHaveLength(1);
  });

  it("saves the assistant's settings only after the model answers the check", async () => {
    const refusing: Model = async () => {
      throw new Error("400 Unsupported parameter: 'reasoning.effort'");
    };
    const bad = await saveAssistantSettings({ mode: "auto", model: "gpt-4o", effort: "low" }, refusing);
    expect(bad).toMatchObject({ ok: false });
    expect(!bad.ok && bad.error).toMatch(/gpt-4o с размышлением «low»: 400 Unsupported/);
    expect(await assistantSettings()).toMatchObject({ model: "test-model" }); // unchanged

    const checked = script("ок");
    expect(await saveAssistantSettings({ mode: "draft", model: "gpt-6-luna", effort: "none" }, checked.model)).toMatchObject({ ok: true, checked: true });
    expect(checked.asked[0]).toMatchObject({ model: "gpt-6-luna", effort: "none", tools: [] });
    expect(await assistantSettings()).toEqual({ mode: "draft", model: "gpt-6-luna", effort: "none" });
  });
});
