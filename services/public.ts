// What the site reads and writes (site/docs/crm-contract.md). Shapes are the contract's; every number comes
// from the same services and lib/calc the CRM screens use.
import { and, eq, gt, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, conversations, orders } from "@/db/schema";
import { availableStems, findRule, type TulipType } from "@/lib/calc";
import { almatyDay, dm, hhmm, normalizePhone, tenge } from "@/lib/format";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { orderText } from "@/lib/templates";
import { currentSeason, seasonRules, stockInput, tulips } from "./catalog";
import { sendMessage, whatsappConversation } from "./messages";
import { createOrder, orderCard, orderView } from "./orders";

const SITE_PCTS = [40, 60, 80, 100];
const DAY = 86_400_000;
const PHONE_ERROR = "Телефон: казахстанский номер, +7 и 10 цифр";

// GET /public/season/current — the open season as the site shows it: today's prices, the grid, stock in words
export async function seasonCurrent() {
  const season = await currentSeason();
  if (!season) return null;
  const s = season.settings;
  const day = almatyDay(new Date());
  const [rules, products, input] = await Promise.all([seasonRules(season.id), tulips(), stockInput(season.id)]);
  const free = availableStems(input);
  const fewBelow = (s.stock_few_below_pct ?? DEFAULT_SETTINGS.stock_few_below_pct) / 100;

  // price at 100 % prepayment today; after the last period the last price stays on show (sale closed)
  const at100 = (t: TulipType) => {
    const mine = rules.filter((r) => r.tulipType === t && r.prepaymentMinPct <= 100 && 100 <= r.prepaymentMaxPct);
    const now = findRule(mine, t, day, 100) ?? mine.at(-1) ?? null;
    const next = now && mine.find((r) => r.dateFrom > now.dateTo);
    return { today: now?.pricePerStem ?? 0, next: next ? { from: next.dateFrom, price: next.pricePerStem } : null };
  };

  return {
    season: {
      id: season.id,
      name: season.name,
      saleOpen: season.status === "open",
      peakDate: season.peakDate,
      pickupFrom: season.pickupFrom,
      pickupTo: season.pickupTo,
      peakHoursFrom: s.peak_hours_from,
    },
    asOf: new Date().toISOString(),
    prices: { classic: at100("classic"), double: at100("double") },
    priceGrid: rules.flatMap((r) =>
      SITE_PCTS.filter((p) => r.prepaymentMinPct <= p && p <= r.prepaymentMaxPct).map((p) => ({
        periodEnd: r.dateTo,
        prepaymentPct: p,
        type: r.tulipType,
        pricePerStem: r.pricePerStem,
      })),
    ),
    stock: products
      .filter((p) => p.isActive)
      .map((p) => {
        const n = Math.max(0, free.get(p.id) ?? 0);
        const planned = input.plans.find((x) => x.productId === p.id)?.plannedStems ?? 0;
        return {
          productId: p.id,
          color: p.color ?? "",
          type: p.tulipType as TulipType,
          status: n === 0 ? "none" : n >= planned * fewBelow ? "many" : "few",
          maxPacks: Math.floor(n / p.packSize),
        };
      }),
  };
}

export type SiteOrder = {
  items: { productId: string; packs: number }[];
  prepaymentPct: number;
  pickupDate: string;
  pickupSlot: string; // "08:00–12:00": the CRM keeps the start as pickup_time
  pickupMethod: string;
  storage: boolean;
  client: { company: string; name: string; phone: string; legalType: string; bin: string; orgName: string };
  comment: string;
  prefillToken: string;
};

// POST /public/orders: the client's order through services/orders, then `booking` to the client and a line for Tatiana
export async function createSiteOrder(o: SiteOrder) {
  const slot = /^(\d{2}:\d{2})/.exec(o.pickupSlot)?.[1] ?? null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.pickupDate) || !slot) return { ok: false as const, error: "Укажите дату и время выдачи" };
  const legal = o.client.legalType === "too" ? `ТОО «${o.client.orgName}», БИН ${o.client.bin}` : ""; // no BIN field in clients (spec §6): it travels in the comment
  const r = await createOrder(
    {
      phone: o.client.phone,
      name: o.client.name,
      company: o.client.company,
      lines: o.items.map((i) => ({ productId: i.productId, qtyPacks: i.packs })),
      pct: o.prepaymentPct,
      pickupDate: o.pickupDate,
      pickupTime: slot,
      pickupMethod: o.pickupMethod === "client_truck" ? "client_truck" : "self_pickup",
      storage: o.storage,
      commentClient: [legal, o.comment].filter(Boolean).join("\n"),
      commentInternal: "",
      channel: "site",
      createdBy: "client",
      prefillToken: o.prefillToken || null,
    },
    null,
  );
  if (!r.ok) return r;
  const card = (await orderCard(r.id))!;
  const sent = await sendMessage({ phone: card.client.phone, text: orderText("booking", orderView(card)), templateKey: "booking", orderId: r.id }, null);
  // Tatiana's push: the server log until the Telegram bot (stage H)
  console.log(`[site] заказ ${r.number} (${r.status}) от ${card.client.phone}, ${tenge(card.order.total)}; booking: ${sent.ok ? sent.provider : sent.error}`);
  return {
    ok: true as const,
    orderNumber: r.number,
    token: card.order.publicToken,
    holdUntil: card.order.holdUntil,
    total: card.order.total,
    prepaymentAmount: card.money.prepayment,
    pricesLockedAt: card.order.priceLockedAt,
  };
}

// GET /public/orders/{token}: the client's order page; opening it reprices an unlocked order like the CRM card does
export async function orderByToken(token: string) {
  if (!/^[0-9a-f-]{36}$/i.test(token)) return null;
  const [row] = await db.select({ id: orders.id }).from(orders).where(eq(orders.publicToken, token));
  const card = row && (await orderCard(row.id));
  if (!card) return null;
  const { order: o, items, payments, events, money: m } = card;
  const invoice = payments.find((p) => p.status === "pending" && p.method === "kaspi_invoice");
  const eventType = (e: (typeof events)[number]["e"]) => {
    const p = e.payload as { created?: boolean; status?: string };
    if (e.type === "status_change") return p.created ? "created" : e.toStatus;
    if (e.type === "payment") return p.status === "pending" ? "invoice" : p.status === "paid" ? "paid" : null;
    return null;
  };
  return {
    orderNumber: o.number,
    status: o.status,
    asOf: new Date().toISOString(), // the CRM's clock, so «days left» doesn't depend on the visitor's
    holdUntil: o.status === "confirmed" ? o.holdUntil : null,
    prepaymentPct: o.prepaymentPct,
    items: items.map((i) => ({ productId: i.productId, color: i.color ?? "", type: i.tulipType, packs: i.qtyPacks, stems: i.qtyStems, pricePerStem: i.unitPrice, sum: i.lineTotal })),
    total: o.total,
    paid: m.paid,
    prepaymentDue: m.prepaymentDue,
    invoice: invoice ? { provider: "kaspi" as const, amount: invoice.amount, expiresAt: null } : null,
    pickup: { date: o.pickupDate, slot: hhmm(o.pickupTime), method: o.pickupMethod === "client_truck" ? "client_truck" : "self", storage: o.storageRequested },
    events: events
      .map(({ e }) => ({ at: e.createdAt.toISOString(), type: eventType(e) }))
      .filter((e): e is { at: string; type: string } => !!e.type)
      .reverse(), // the card lists newest first; the site tells the story in order
  };
}

// «Ссылка для заказа»: a fresh token on the client's WhatsApp dialog, 30 days (spec §14, conversations.prefill_token)
export async function createPrefill(phone: string) {
  const p = normalizePhone(phone);
  if (!p) return { ok: false as const, error: PHONE_ERROR };
  const token = crypto.randomUUID();
  await whatsappConversation(p, { prefillToken: token, prefillTokenAt: new Date() });
  return { ok: true as const, url: `${process.env.SITE_URL ?? ""}/tulpan/zakaz?c=${token}` };
}

// GET /public/prefill/{token}: contacts for the site's form; null = unknown or older than 30 days
export async function prefill(token: string) {
  const [row] = await db
    .select({ name: clients.name, company: clients.company, phone: clients.phone })
    .from(conversations)
    .innerJoin(clients, eq(clients.id, conversations.clientId))
    .where(and(eq(conversations.prefillToken, token), gt(conversations.prefillTokenAt, new Date(Date.now() - 30 * DAY))));
  return row ? { client: { name: row.name, company: row.company ?? "", phone: row.phone } } : null;
}

const SEGMENT = {
  private: { type: "private", label: "частный интерьер" },
  office: { type: "other", label: "офис" },
  horeca: { type: "other", label: "HoReCa" },
  designer: { type: "landscaper", label: "прайс для дизайнера" },
} as const;
export type Segment = keyof typeof SEGMENT;

// POST /public/leads and /public/designer-price: no leads table (spec §6) — a client with a dated note
export async function recordLead(l: { segment: Segment; phone: string; company: string; message: string }) {
  const phone = normalizePhone(l.phone);
  if (!phone) return { ok: false as const, error: PHONE_ERROR };
  const note = [`${dm(almatyDay(new Date()))} Botanica, ${SEGMENT[l.segment].label}`, l.company, l.message].filter(Boolean).join(", ");
  await db
    .insert(clients)
    .values({ phone, company: l.company || null, clientType: SEGMENT[l.segment].type, source: "inbound_message", notes: note })
    .onConflictDoUpdate({
      target: clients.phone,
      set: { company: sql`coalesce(excluded.company, ${clients.company})`, notes: sql`concat_ws(E'\n', nullif(${clients.notes}, ''), excluded.notes)` },
    });
  console.log(`[site] лид: ${note}, ${phone}`);
  return { ok: true as const };
}
