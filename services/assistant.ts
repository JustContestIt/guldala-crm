// WhatsApp assistant (spec §19): a questionnaire in the manner of assistant/brief-reference.md. It answers from the
// knowledge base and books the order; prices, stock and orders come from the CRM services, the model only talks.
import { readFileSync } from "node:fs";
import path from "node:path";
import { and, desc, eq, notInArray, sql } from "drizzle-orm";
import type { ResponseInputItem } from "openai/resources/responses/responses";
import { db } from "@/db";
import { clients, conversations, messages, orders } from "@/db/schema";
import { chatAllowed, messaging, type MessagingProvider } from "@/integrations/messaging";
import { DEFAULT_EFFORT, DEFAULT_MODEL, EFFORTS, respond, type Effort, type Model, type Tool } from "@/integrations/openai";
import type { TulipType } from "@/lib/calc";
import { almatyDay, dmhm, prettyPhone, tenge } from "@/lib/format";
import { num, obj, str } from "@/lib/json";
import { computeQuote, type ProductOpt } from "@/lib/quote";
import { STATUS_LABEL } from "@/lib/status";
import { currentSeason, productOpts, seasonRules, tulips, type Season } from "./catalog";
import { sendDraft, type Inbound } from "./messages";
import { createPrefill, createSiteOrder, seasonCurrent, SITE_PCTS } from "./public";
import { readState, saveState } from "./settings";

const SETTLE_MS = 5_000; // clients send two or three messages in a row: one answer to all of them
const MAX_STEPS = 6;
const ANSWERED = ["text", "image", "audio", "video", "document"]; // a client writing; calls and system notes get no answer

export const MODES = ["off", "draft", "auto"] as const;
export type AssistantSettings = { mode: (typeof MODES)[number]; model: string; effort: Effort };

type Ctx = { season: Season; mode: "draft" | "auto"; clientId: string; conversationId: string; phone: string; acted: boolean };
type Args = Record<string, unknown>;

// ——— tools: strict JSON schemas (every field required, null = not known) ———

const object = (properties: Record<string, unknown>) => ({ type: "object", properties, required: Object.keys(properties), additionalProperties: false });
const nullable = (type: string, description: string) => ({ type: [type, "null"], description });
const ITEMS = {
  type: "array",
  description: "Состав: color — точное название цвета из stock_and_prices, packs — пачек",
  items: object({ color: { type: "string" }, packs: { type: "integer" } }),
};
const PCT = { type: "integer", description: "% предоплаты: от 40 до 100, шаг 10" };

const TOOLS: Tool[] = [
  { name: "stock_and_prices", description: "Наличие по цветам словами (много / мало / нет) и цена за штуку на сегодня при предоплате 40, 60, 80 и 100 %.", parameters: object({}) },
  {
    name: "calculate",
    description: "Точный расчёт заказа по сетке цен CRM: строки, итог, предоплата и problems (минимум, наличие, дата, % предоплаты). Сводку клиенту строй только по нему.",
    parameters: object({
      items: ITEMS,
      prepaymentPct: PCT,
      pickupDate: nullable("string", "дата вывоза ГГГГ-ММ-ДД, если уже известна"),
      storage: { type: "boolean", description: "холодильник до вывоза (платно, по дням от сегодня до вывоза)" },
    }),
  },
  {
    name: "update_client",
    description: "Сохранить, как обращаться к клиенту и его магазин или компанию — сразу, как узнал. null — не менять.",
    parameters: object({ name: nullable("string", "как обращаться"), company: nullable("string", "магазин или компания") }),
  },
  {
    name: "create_order",
    description: "Оформить заказ — только после того, как клиент подтвердил сводку («да»). Клиенту сразу уйдёт подтверждение с номером заказа.",
    parameters: object({
      items: ITEMS,
      prepaymentPct: PCT,
      pickupDate: nullable("string", "дата вывоза ГГГГ-ММ-ДД"),
      pickupTime: nullable("string", "время вывоза ЧЧ:ММ"),
      pickupMethod: { type: "string", enum: ["self_pickup", "client_truck"], description: "самовывоз или своя машина клиента" },
      storage: { type: "boolean", description: "холодильник до вывоза" },
      legalType: { type: "string", enum: ["ip", "too", "person"], description: "счёт на ИП, на ТОО или на физическое лицо" },
      bin: nullable("string", "БИН ТОО, 12 цифр"),
      orgName: nullable("string", "название ТОО"),
      comment: nullable("string", "пожелания по сортам и прочее для Татьяны"),
    }),
  },
  { name: "order_link", description: "Ссылка на каталог с фото, где клиент соберёт заказ сам; его контакты подставятся.", parameters: object({}) },
  {
    name: "handoff",
    description:
      "Передать чат Татьяне: скидки, доставка, сроки, просьба позвать человека, жалоба, вопрос по оформленному заказу или возврату, факт о хозяйстве, которого нет в базе знаний. Не для помощи с выбором и не для вопросов о цветах, ценах и заказе. После вызова бот в этом чате молчит.",
    parameters: object({ reason: { type: "string", description: "о чём клиент спрашивает — коротко, для Татьяны" } }),
  },
];

const norm = (s: string) => s.toLowerCase().replace(/ё/g, "е").replace(/\s+/g, " ").trim();

// The model names colors as stock_and_prices lists them; unknown names come back as problems
function lines(v: unknown, products: ProductOpt[]) {
  const unknown: string[] = [];
  const out = (Array.isArray(v) ? v : []).flatMap((i) => {
    const color = str(obj(i).color, 100);
    const p = products.find((x) => norm(x.name) === norm(color));
    if (p) return [{ key: p.id, packs: num(obj(i).packs) }];
    unknown.push(`Нет цвета «${color}». Есть: ${products.map((x) => x.name).join(", ")}`);
    return [];
  });
  return { lines: out, unknown };
}

const day = (v: unknown) => {
  const s = str(v, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
};
// the CRM's shortage text has numbers; the client hears only that there isn't that much
const wordsOnly = (s: string) => s.replace(/ — свободно \d+ пач\., запрошено \d+/g, ": столько нет в наличии");

const WORD = { many: "много", few: "мало", none: "нет" } as const;

const RUN: Record<string, (a: Args, c: Ctx) => Promise<unknown>> = {
  async stock_and_prices() {
    const sc = await seasonCurrent();
    if (!sc) return { error: "Сезона нет — передай вопрос Татьяне" };
    const names = new Map((await tulips()).map((p) => [p.id, p.name]));
    const today = almatyDay(new Date());
    const prices = (type: TulipType) => {
      const now = sc.priceGrid.filter((g) => g.type === type && g.periodEnd >= today); // the grid goes by period, earliest first
      return { ...Object.fromEntries(SITE_PCTS.map((p) => [`${p}%`, now.find((g) => g.prepaymentPct === p)?.pricePerStem ?? null])), until: now[0]?.periodEnd ?? null };
    };
    return {
      saleOpen: sc.season.saleOpen,
      colors: sc.stock.map((x) => ({ color: names.get(x.productId), stock: WORD[x.status as keyof typeof WORD] })),
      pricePerStemToday: { classic: prices("classic"), double: prices("double") },
    };
  },

  async calculate(a, c) {
    const products = await productOpts(c.season.id);
    const l = lines(a.items, products);
    const date = day(a.pickupDate);
    const pct = num(a.prepaymentPct);
    const s = c.season;
    const q = computeQuote({ lines: l.lines, products, rules: await seasonRules(s.id), settings: s.settings, today: almatyDay(new Date()), pct, date, pickupFrom: s.pickupFrom, pickupTo: s.pickupTo, storage: a.storage === true });
    return {
      lines: q.priced.lines.map((x) => ({ color: x.name, packs: x.qtyPacks, stems: x.qtyStems, pricePerStem: x.unitPrice, sum: x.lineTotal })),
      ...(q.storage.fee > 0 && { fridge: { days: q.storage.days, fee: q.storage.fee } }),
      total: q.total,
      prepaymentPct: pct,
      prepayment: q.prepayment,
      restOnPickup: q.total - q.prepayment,
      priceValidUntil: q.priced.validUntil,
      problems: [
        ...l.unknown,
        ...(a.pickupDate && !date ? ["Дата вывоза — в виде ГГГГ-ММ-ДД"] : []),
        ...q.problems,
        ...q.shortages.map(wordsOnly),
        ...(q.priced.missing.length ? ["Нет цены на сегодня — передай вопрос Татьяне"] : []),
      ],
      ...(q.overThreshold && { note: "Крупный заказ: Татьяна проверит наличие и подтвердит бронь сама" }),
    };
  },

  async update_client(a, c) {
    const set = { ...(str(a.name, 100) && { name: str(a.name, 100) }), ...(str(a.company, 150) && { company: str(a.company, 150) }) };
    if (!Object.keys(set).length) return { error: "Нечего сохранять" };
    await db.update(clients).set(set).where(eq(clients.id, c.clientId));
    return { saved: set };
  },

  // The site's path (createSiteOrder) with channel = whatsapp: the same checks, the same `booking` to the client
  async create_order(a, c) {
    const [cl] = await db.select({ name: clients.name, company: clients.company }).from(clients).where(eq(clients.id, c.clientId));
    const l = lines(a.items, await productOpts(c.season.id));
    const pickupDate = day(a.pickupDate);
    const pickupTime = str(a.pickupTime, 5);
    const legalType = a.legalType === "too" || a.legalType === "person" ? a.legalType : "ip";
    const bin = str(a.bin, 20).replace(/\D/g, "");
    const orgName = str(a.orgName, 150).replace(/^ТОО\s*/i, "").replace(/^[«"“]+|[»"”]+$/g, ""); // the comment adds «ТОО «…»» itself
    const missing = [
      !cl.name && "имя (сохрани через update_client)",
      !cl.company && legalType !== "person" && "магазин (сохрани через update_client)", // a person buys without a shop, as on the site
      !l.lines.length && "состав",
      !pickupDate && "дата вывоза",
      !pickupTime && "время вывоза",
      legalType === "too" && bin.length !== 12 && "БИН ТОО (12 цифр)",
      legalType === "too" && !orgName && "название ТОО",
    ].filter(Boolean);
    if (l.unknown.length || missing.length)
      return { error: [...l.unknown, missing.length ? `Не хватает: ${missing.join(", ")}` : ""].filter(Boolean).join(". ") + ". Заказ не оформлен — спроси у клиента." };
    const r = await createSiteOrder(
      {
        items: l.lines.map((x) => ({ productId: x.key, packs: x.packs })),
        prepaymentPct: num(a.prepaymentPct),
        pickupDate: pickupDate!,
        pickupSlot: pickupTime,
        pickupMethod: a.pickupMethod === "client_truck" ? "client_truck" : "self_pickup",
        storage: a.storage === true,
        client: { company: cl.company ?? "", name: cl.name, phone: c.phone, legalType, bin, orgName },
        comment: str(a.comment, 1000),
        prefillToken: "",
      },
      "whatsapp",
    );
    if (!r.ok) return { error: `CRM не приняла заказ: ${wordsOnly(r.error)}. Объясни клиенту и попроси поправить.` };
    c.acted = true;
    return {
      orderNumber: r.orderNumber,
      total: r.total,
      prepayment: r.prepaymentAmount,
      status: r.holdUntil ? `бронь до ${dmhm(r.holdUntil)}` : "ждёт подтверждения Татьяны",
      sent: "Клиенту уже ушло подтверждение с номером и составом — не повторяй его",
    };
  },

  async order_link(_, c) {
    const r = await createPrefill(c.phone);
    return r.ok ? { url: r.url } : { error: r.error };
  },

  async handoff(a, c) {
    const reason = str(a.reason, 300) || "без причины";
    await db.update(conversations).set({ assistantMutedAt: new Date() }).where(eq(conversations.id, c.conversationId));
    // Tatiana's note: the client card and the server log until the Telegram bot (stage H)
    const note = `${dmhm(new Date())} бот передал Татьяне: ${reason}`;
    await db
      .update(clients)
      .set({ notes: sql`concat_ws(E'\n', nullif(${clients.notes}, ''), ${note}::text)` })
      .where(eq(clients.id, c.clientId));
    console.log(`[assistant] handoff ${prettyPhone(c.phone)}: ${reason}`);
    c.acted = true;
    return { done: "Чат передан Татьяне, дальше бот здесь молчит. Напиши клиенту одной фразой, что передал вопрос Татьяне и она ответит." };
  },
};

async function tool(name: string, args: string, c: Ctx) {
  const run = RUN[name];
  if (!run || (name === "create_order" && c.mode !== "auto")) return { error: `Инструмент ${name} недоступен` };
  try {
    return await run(obj(JSON.parse(args)), c);
  } catch (e) {
    console.error(`[assistant] ${name} failed:`, e);
    return { error: "Сбой CRM — извинись и передай вопрос Татьяне (handoff)" };
  }
}

// ——— the prompt: rules and knowledge from assistant/*.md, then the season's numbers; the same on every call ———

export const promptFile = (f: "restrictions.md" | "knowledge.md") => readFileSync(path.join(process.cwd(), "assistant", f), "utf8");

function instructions(season: Season) {
  const s = season.settings;
  const facts = [
    `# Условия сезона «${season.name}» (настройки CRM)`,
    `- Пачка — ${s.pack_size} шт. Минимальный заказ — ${s.min_order_stems} шт ${s.min_order_scope === "total" ? "в сумме по заказу" : "каждого цвета"}.`,
    `- Предоплата — от ${s.prepayment_min_pct} до ${s.prepayment_max_pct} %, шаг ${s.prepayment_step} %.`,
    `- Без предоплаты бронь держится ${s.hold_days} дн. Цена фиксируется ${s.price_lock_on === "prepaid" ? "при предоплате" : "при подтверждении брони"}.`,
    `- Заказ от ${tenge(s.check_threshold_amount)} Татьяна проверяет и подтверждает сама.`,
    `- Пик — ${season.peakDate}. Выдача с ${season.pickupFrom} по ${season.pickupTo}, ${s.pickup_hours}${s.peak_hours_from ? `; с ${s.peak_hours_from} — ${s.pickup_hours_peak}` : ""}.`,
    `- Холодильник до вывоза — ${tenge(s.storage_fee_per_day)} в сутки за заказ, считается от дня заказа до дня вывоза и входит в сумму заказа.`,
  ];
  return [promptFile("restrictions.md"), promptFile("knowledge.md"), facts.join("\n")].join("\n\n");
}

// What changes from chat to chat goes first in the input, after the cached instructions
async function context(c: Ctx) {
  const [cl] = await db.select({ name: clients.name, company: clients.company }).from(clients).where(eq(clients.id, c.clientId));
  const list = await db
    .select({ number: orders.number, status: orders.status, total: orders.total, pickupDate: orders.pickupDate })
    .from(orders)
    .where(and(eq(orders.clientId, c.clientId), eq(orders.seasonId, c.season.id), notInArray(orders.status, ["expired", "cancelled"])))
    .orderBy(desc(orders.createdAt))
    .limit(5);
  return [
    `Сегодня ${almatyDay(new Date())}.`,
    `Клиент: ${cl.name ? `имя — ${cl.name}` : "имя неизвестно"}, ${cl.company ? `магазин — ${cl.company}` : "магазин неизвестен"}. Телефон известен из чата.`,
    `Заказы клиента в этом сезоне: ${list.length ? list.map((o) => `${o.number} — ${STATUS_LABEL[o.status]}, ${tenge(o.total)}${o.pickupDate ? `, вывоз ${o.pickupDate}` : ""}`).join("; ") : "нет"}.`,
    c.mode === "draft" ? "Режим черновиков: ответ сначала проверит Татьяна, create_order недоступен — после «да» дай ссылку order_link или скажи, что Татьяна оформит заказ." : "",
  ]
    .filter(Boolean)
    .join("\n");
}

// The chat as the model sees it: the client is `user`, everything from our side (Tatiana, the CRM, the bot) is `assistant`
async function history(conversationId: string): Promise<ResponseInputItem[]> {
  const rows = await db
    .select({ direction: messages.direction, text: messages.text })
    .from(messages)
    .where(and(eq(messages.conversationId, conversationId), notInArray(messages.status, ["draft", "error"])))
    .orderBy(desc(messages.createdAt))
    .limit(30);
  return rows.reverse().map((r) => ({ role: r.direction === "in" ? "user" : "assistant", content: r.text }));
}

// Muted, or a newer client message arrived: that message's run answers them all
async function stale(m: Inbound) {
  const [r] = await db
    .select({
      mutedAt: conversations.assistantMutedAt,
      newer: sql<boolean>`exists (select 1 from messages n where n.conversation_id = ${m.conversationId} and n.direction = 'in'
        and n.created_at > (select created_at from messages where id = ${m.id}))`,
    })
    .from(conversations)
    .where(eq(conversations.id, m.conversationId));
  return r.mutedAt ? "the chat is muted" : r.newer ? "a newer message answers" : null;
}

// Why the bot stayed silent goes to the log: otherwise a muted chat looks like a broken bot
const silent = (m: Inbound, why: string) => console.log(`[assistant] no answer: ${why}, conversation ${m.conversationId}`);

async function answer(text: string, m: Inbound, c: Ctx, provider: MessagingProvider) {
  const body = text.trim();
  if (!body) return silent(m, "the model gave no text");
  const why = c.acted ? null : await stale(m); // after an order or a handoff the client hears about it anyway
  if (why) return silent(m, why);
  await db.delete(messages).where(and(eq(messages.conversationId, m.conversationId), eq(messages.status, "draft"))); // an older draft answered less
  const [draft] = await db
    .insert(messages)
    .values({ conversationId: m.conversationId, direction: "out", author: "assistant", text: body, status: "draft" })
    .returning({ id: messages.id });
  if (c.mode === "auto") await sendDraft(draft.id, body, null, provider);
}

// A new client message (receiveWebhook) → an answer: a draft for Tatiana or, in `auto`, sent right away.
// Silent when the season's mode is off, the chat is muted, there is no OPENAI_API_KEY or the number isn't a test one.
export async function replyTo(m: Inbound, deps: { model?: Model; provider?: MessagingProvider; settleMs?: number } = {}) {
  const { model = respond, provider = messaging(), settleMs = SETTLE_MS } = deps;
  const [a, season] = await Promise.all([assistantSettings(), currentSeason()]);
  const mode = a.mode;
  if (!season || mode === "off" || !process.env.OPENAI_API_KEY || !chatAllowed(m.chatId) || !ANSWERED.includes(m.type)) return;
  await new Promise((r) => setTimeout(r, settleMs));
  const why = await stale(m);
  if (why) return silent(m, why);
  const c: Ctx = { season, mode, clientId: m.clientId, conversationId: m.conversationId, phone: `+${m.chatId}`, acted: false };
  try {
    const prompt = instructions(season);
    const tools = TOOLS.filter((t) => mode === "auto" || t.name !== "create_order");
    const input: ResponseInputItem[] = [{ role: "developer", content: await context(c) }, ...(await history(m.conversationId))];
    for (let step = 0; step < MAX_STEPS; step++) {
      const r = await model({ model: a.model, effort: a.effort, instructions: prompt, input, tools });
      input.push(...r.items);
      if (!r.calls.length) return await answer(r.text, m, c, provider);
      for (const call of r.calls) input.push({ type: "function_call_output", call_id: call.callId, output: JSON.stringify(await tool(call.name, call.arguments, c)) });
    }
    console.error(`[assistant] no answer in ${MAX_STEPS} steps, conversation ${m.conversationId}`);
  } catch (e) {
    console.error(`[assistant] failed, conversation ${m.conversationId}:`, e);
  }
}

// «Ещё → Ассистент»: off / draft / auto, the model and its reasoning effort (app_state "assistant")
export async function assistantSettings(): Promise<AssistantSettings> {
  const v = await readState("assistant");
  return {
    mode: MODES.find((x) => x === v.mode) ?? "off",
    model: str(v.model, 100) || DEFAULT_MODEL,
    effort: EFFORTS.find((x) => x === v.effort) ?? DEFAULT_EFFORT,
  };
}

// Saving asks the model one short question: a model or an effort OpenAI refuses would otherwise leave the bot silent unseen
export async function saveAssistantSettings(s: AssistantSettings, model: Model = respond) {
  if (!/^[\w.:-]{2,100}$/.test(s.model)) return { ok: false as const, error: "Модель — название из списка OpenAI" };
  if (process.env.OPENAI_API_KEY)
    try {
      await model({ model: s.model, effort: s.effort, instructions: "Ответь одним словом.", input: [{ role: "user", content: "Проверка связи" }], tools: [] });
    } catch (e) {
      return { ok: false as const, error: `OpenAI не принял ${s.model}${s.effort ? ` с размышлением «${s.effort}»` : ""}: ${e instanceof Error ? e.message : e}` };
    }
  else if (s.mode !== "off") return { ok: false as const, error: "Нет OPENAI_API_KEY — ассистент не сможет отвечать" };
  await saveState("assistant", s);
  return { ok: true as const, checked: !!process.env.OPENAI_API_KEY };
}
