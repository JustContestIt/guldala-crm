// Every change of an order's status or money goes through here: one transaction, one order_events row (spec §3.10)
import { and, asc, desc, eq, ilike, inArray, isNotNull, lt, or, sql } from "drizzle-orm";
import { db, type Db } from "@/db";
import { clients, orderEvents, orderItems, orders, payments, products, seasons, users } from "@/db/schema";
import {
  findRule,
  money,
  orderProblems,
  priceLines,
  RESERVING,
  shortages,
  type Status,
  type TulipType,
} from "@/lib/calc";
import { almatyDay, dm, normalizePhone, prettyPhone, tenge } from "@/lib/format";
import { hoursFor } from "@/lib/settings";
import { canMove, PAYABLE, STATUS_LABEL } from "@/lib/status";
import type { OrderView } from "@/lib/templates";
import { available, currentSeason, getSeason, lockStock, seasonRules, tulips, type Season } from "./catalog";

export type Actor = { id: string; role: "owner" | "operator" };
export type Order = typeof orders.$inferSelect;
export type Channel = Order["channel"];
export type PayMethod = (typeof payments.$inferSelect)["method"];
export type Result<T extends object = object> = ({ ok: true } & T) | { ok: false; error: string };

// A business rule said no: rolls the transaction back and reaches the user as text
class Refusal extends Error {}
function fail(msg: string): never {
  throw new Refusal(msg);
}

async function run<T extends object>(fn: () => Promise<T | void>): Promise<Result<T>> {
  try {
    return { ok: true, ...((await fn()) as T) };
  } catch (e) {
    if (e instanceof Refusal) return { ok: false, error: e.message };
    throw e;
  }
}

const TYPE_NAME: Record<TulipType, string> = { classic: "классика", double: "махровые" };
const HOUR = 3_600_000;

function log(
  tx: Db,
  orderId: string,
  actor: Actor | null,
  type: (typeof orderEvents.$inferInsert)["type"],
  extra: { fromStatus?: string | null; toStatus?: string; payload?: Record<string, unknown>; actorType?: "client" } = {},
) {
  const { actorType = actor ? "user" : "system", ...rest } = extra;
  return tx.insert(orderEvents).values({ orderId, type, actorType, actorId: actor?.id ?? null, ...rest });
}

async function setStatus(tx: Db, o: Order, to: Status, actor: Actor | null, set: Partial<Order> = {}, payload?: Record<string, unknown>) {
  if (!canMove(o.status, to)) fail(`Нельзя перевести заказ из «${STATUS_LABEL[o.status]}» в «${STATUS_LABEL[to]}»`);
  const [n] = await tx.update(orders).set({ ...set, status: to }).where(eq(orders.id, o.id)).returning();
  await log(tx, o.id, actor, "status_change", { fromStatus: o.status, toStatus: to, payload });
  return n;
}

// confirmed holds whose time ran out → expired, freeing the flowers. Lazy before each operation now, cron at stage 4.
export async function expireHolds(d: Db = db) {
  return d.transaction(async (tx) => {
    const rows = await tx
      .update(orders)
      .set({ status: "expired" })
      .where(and(eq(orders.status, "confirmed"), lt(orders.holdUntil, new Date())))
      .returning({ id: orders.id });
    if (rows.length)
      await tx.insert(orderEvents).values(
        rows.map((r) => ({ orderId: r.id, type: "status_change" as const, fromStatus: "confirmed", toStatus: "expired", actorType: "system" as const })),
      );
    return rows.length;
  });
}

async function lockOrder(tx: Db, id: string) {
  const [o] = await tx.select().from(orders).where(eq(orders.id, id)).for("update");
  return o ?? fail("Заказ не найден");
}

const itemRows = (d: Db, orderId: string | string[]) =>
  d
    .select({
      id: orderItems.id,
      orderId: orderItems.orderId,
      productId: orderItems.productId,
      substituteProductId: orderItems.substituteProductId,
      substitutionNote: orderItems.substitutionNote,
      qtyPacks: orderItems.qtyPacks,
      packSize: orderItems.packSize,
      qtyStems: orderItems.qtyStems,
      unitPrice: orderItems.unitPrice,
      lineTotal: orderItems.lineTotal,
      issuedStems: orderItems.issuedStems,
      name: products.name,
      tulipType: products.tulipType,
      color: products.color,
      substituteName: sql<string | null>`(select name from products s where s.id = ${orderItems.substituteProductId})`,
    })
    .from(orderItems)
    .innerJoin(products, eq(products.id, orderItems.productId))
    .where(Array.isArray(orderId) ? inArray(orderItems.orderId, orderId) : eq(orderItems.orderId, orderId))
    .orderBy(asc(orderItems.createdAt), asc(products.sortOrder));

export type ItemRow = Awaited<ReturnType<typeof itemRows>>[number];

const paysOf = (d: Db, orderId: string) => d.select().from(payments).where(eq(payments.orderId, orderId)).orderBy(asc(payments.createdAt));

type StockLine = { productId: string; name: string; qtyStems: number; packSize: number };

type LineLike = Pick<ItemRow, "productId" | "substituteProductId" | "name" | "substituteName" | "qtyStems" | "packSize">;

// Stock lines of the order as it stands: a substituted line takes the substitute's flowers
const stockLines = (items: LineLike[]): StockLine[] =>
  items.map((i) => ({
    productId: i.substituteProductId ?? i.productId,
    name: i.substituteName ?? i.name,
    qtyStems: i.qtyStems,
    packSize: i.packSize,
  }));

// Locks the season's stock and refuses if `lines` don't fit next to every other order
async function checkStock(tx: Db, o: Order, lines: StockLine[]) {
  await lockStock(tx, o.seasonId);
  const short = shortages(lines, await available(o.seasonId, tx, o.id));
  if (short.length) fail(`Не хватает: ${short.join("; ")}`);
}

async function retotal(tx: Db, o: Order) {
  const [{ s }] = await tx
    .select({ s: sql<number>`coalesce(sum(${orderItems.lineTotal}), 0)::int` })
    .from(orderItems)
    .where(eq(orderItems.orderId, o.id));
  const discount = Math.min(o.discountAmount, s);
  const [n] = await tx.update(orders).set({ subtotal: s, discountAmount: discount, total: s - discount }).where(eq(orders.id, o.id)).returning();
  return n;
}

// Until the price is locked the order costs what the grid says today (spec §9)
async function reprice(tx: Db, o: Order, actor: Actor | null) {
  if (o.priceLockedAt || !["new", "confirmed", "expired"].includes(o.status)) return o;
  const day = almatyDay(new Date());
  const rules = await seasonRules(o.seasonId, tx);
  let changed = false;
  for (const it of await itemRows(tx, o.id)) {
    const rule = findRule(rules, it.tulipType as TulipType, day, o.prepaymentPct);
    if (!rule || rule.pricePerStem === it.unitPrice) continue; // no price today: keep the last one
    changed = true;
    await tx
      .update(orderItems)
      .set({ unitPrice: rule.pricePerStem, priceRuleId: rule.id, lineTotal: it.qtyStems * rule.pricePerStem })
      .where(eq(orderItems.id, it.id));
  }
  if (!changed) return o;
  const n = await retotal(tx, o);
  await log(tx, o.id, actor, "edit", { payload: { repriced: day, totalFrom: o.total, totalTo: n.total } });
  return n;
}

// Payment reached the prepayment of a confirmed order → prepaid, price locked
async function syncPrepaid(tx: Db, o: Order, actor: Actor | null) {
  if (o.status !== "confirmed") return o;
  const m = money(o.total, o.prepaymentPct, await paysOf(tx, o.id));
  if (!m.prepaid) return o;
  return setStatus(tx, o, "prepaid", actor, { priceLockedAt: o.priceLockedAt ?? new Date() }, { paid: m.paid });
}

// Locks the order for the whole transaction; holds that ran out are expired first
function mutate<T extends object>(orderId: string, fn: (tx: Db, o: Order, season: Season) => Promise<T | void>) {
  return run<T>(async () => {
    await expireHolds();
    return db.transaction(async (tx) => {
      const o = await lockOrder(tx, orderId);
      return fn(tx, o, (await getSeason(o.seasonId, tx))!);
    });
  });
}

const holdFrom = (now: Date, s: Season) => new Date(now.getTime() + s.settings.hold_days * 24 * HOUR);
const lockOnConfirm = (s: Season, now: Date) => (s.settings.price_lock_on === "confirmed" ? now : null);

export type NewOrder = {
  phone: string;
  name: string;
  company: string;
  lines: { productId: string; qtyPacks: number }[];
  pct: number;
  pickupDate: string | null;
  pickupTime: string | null;
  pickupMethod: "self_pickup" | "client_truck";
  storage: boolean;
  commentClient: string;
  commentInternal: string;
  channel: Channel;
  createdBy?: "client" | "operator"; // client = the site form (spec §14): over-stock is refused, not saved as `new`
  prefillToken?: string | null;
};

// Spec §5.3: price by today's grid, then `new` (≥ threshold or short of stock) or `confirmed` with a hold
export function createOrder(input: NewOrder, actor: Actor | null) {
  return run<{ id: string; number: string; status: Status; shortages: string[] }>(async () => {
    const phone = normalizePhone(input.phone) ?? fail("Телефон: казахстанский номер, +7 и 10 цифр");
    const season = await currentSeason();
    if (!season || season.status !== "open") fail("Нет открытого сезона — откройте его в настройках");
    const s = season.settings;
    const all = await tulips();
    const lines = input.lines.map((l) => {
      const p = all.find((x) => x.id === l.productId && x.isActive) ?? fail("Цвет не найден или выключен");
      return { productId: p.id, tulipType: p.tulipType as TulipType, qtyPacks: l.qtyPacks, packSize: p.packSize, name: p.name };
    });
    const problems = orderProblems({
      lines,
      settings: s,
      pct: input.pct,
      pickupDate: input.pickupDate,
      pickupTime: input.pickupTime,
      pickupFrom: season.pickupFrom,
      pickupTo: season.pickupTo,
    });
    if (problems.length) fail(problems.join(". "));
    const day = almatyDay(new Date());
    const priced = priceLines(lines, await seasonRules(season.id), day, input.pct);
    if (priced.missing.length) fail(`Нет цены на ${dm(day)} (${priced.missing.map((t) => TYPE_NAME[t]).join(", ")}) — проверьте сетку цен`);

    await expireHolds();
    return db.transaction(async (tx) => {
      await lockStock(tx, season.id);
      const short = shortages(
        priced.lines.map((l, i) => ({ productId: l.productId!, name: lines[i].name, qtyStems: l.qtyStems, packSize: l.packSize })),
        await available(season.id, tx),
      );
      const byClient = input.createdBy === "client";
      if (short.length && byClient) fail(`Не хватает: ${short.join("; ")}`);
      const status: Status = short.length || priced.subtotal >= s.check_threshold_amount ? "new" : "confirmed";
      const now = new Date();

      const [client] = await tx
        .insert(clients)
        .values({ phone, name: input.name, company: input.company || null, source: "order" })
        .onConflictDoUpdate({
          target: clients.phone,
          set: {
            name: sql`coalesce(nullif(excluded.name, ''), ${clients.name})`,
            company: sql`coalesce(excluded.company, ${clients.company})`,
          },
        })
        .returning({ id: clients.id });
      const [{ seq }] = await tx
        .update(seasons)
        .set({ orderSeq: sql`${seasons.orderSeq} + 1` })
        .where(eq(seasons.id, season.id))
        .returning({ seq: seasons.orderSeq });
      const number = `T-${season.peakDate.slice(0, 4)}-${String(seq).padStart(4, "0")}`;

      const [o] = await tx
        .insert(orders)
        .values({
          number,
          seasonId: season.id,
          clientId: client.id,
          status,
          channel: input.channel,
          createdBy: input.createdBy ?? "operator",
          prepaymentPct: input.pct,
          subtotal: priced.subtotal,
          total: priced.subtotal,
          pickupDate: input.pickupDate,
          pickupTime: input.pickupTime,
          pickupMethod: input.pickupMethod,
          storageRequested: input.storage,
          commentClient: input.commentClient,
          commentInternal: input.commentInternal,
          ...(status === "confirmed" && { confirmedAt: now, holdUntil: holdFrom(now, season), priceLockedAt: lockOnConfirm(season, now) }),
        })
        .returning();
      await tx.insert(orderItems).values(
        priced.lines.map((l) => ({
          orderId: o.id,
          productId: l.productId!,
          qtyPacks: l.qtyPacks,
          packSize: l.packSize,
          qtyStems: l.qtyStems,
          unitPrice: l.unitPrice,
          priceRuleId: l.priceRuleId,
          lineTotal: l.lineTotal,
        })),
      );
      await log(tx, o.id, actor, "status_change", {
        toStatus: status,
        ...(byClient && { actorType: "client" }),
        payload: {
          created: true,
          ...(short.length && { shortages: short }),
          ...(status === "new" && !short.length && { threshold: s.check_threshold_amount }),
          ...(input.prefillToken && { prefill: input.prefillToken }),
        },
      });
      return { id: o.id, number, status, shortages: short };
    });
  });
}

export const confirmOrder = (orderId: string, actor: Actor) =>
  mutate(orderId, async (tx, o, season) => {
    if (o.status !== "new") fail("Подтвердить можно только новый заказ");
    await checkStock(tx, o, stockLines(await itemRows(tx, o.id)));
    o = await reprice(tx, o, actor);
    const now = new Date();
    await setStatus(tx, o, "confirmed", actor, { confirmedAt: now, holdUntil: holdFrom(now, season), priceLockedAt: lockOnConfirm(season, now) });
  });

// Expired hold back to confirmed: stock again, today's price, a new hold (spec §7)
export const resumeOrder = (orderId: string, actor: Actor) =>
  mutate(orderId, async (tx, o, season) => {
    if (o.status !== "expired") fail("Возобновить можно только истёкшую бронь");
    await checkStock(tx, o, stockLines(await itemRows(tx, o.id)));
    o = await reprice(tx, { ...o, priceLockedAt: null }, actor); // a lock taken at confirm doesn't survive expiry
    const now = new Date();
    o = await setStatus(tx, o, "confirmed", actor, { confirmedAt: now, holdUntil: holdFrom(now, season), priceLockedAt: lockOnConfirm(season, now) });
    await syncPrepaid(tx, o, actor);
  });

export const extendHold = (orderId: string, until: Date, actor: Actor) =>
  mutate(orderId, async (tx, o) => {
    if (o.status !== "confirmed") fail("Продлить можно только бронь");
    if (!(until.getTime() > Date.now())) fail("Новый срок брони — в будущем");
    await tx.update(orders).set({ holdUntil: until }).where(eq(orders.id, o.id));
    await log(tx, o.id, actor, "edit", { payload: { holdUntil: { from: o.holdUntil, to: until } } });
  });

export const cancelOrder = (orderId: string, reason: string, actor: Actor) =>
  mutate(orderId, async (tx, o) => {
    if (!reason.trim()) fail("Укажите причину отмены");
    await setStatus(tx, o, "cancelled", actor, { cancelledAt: new Date(), cancelReason: reason.trim() }, { reason: reason.trim() });
  });

export const markReady = (orderId: string, actor: Actor) =>
  mutate(orderId, async (tx, o, season) => {
    if (!season.settings.ready_status_enabled) fail("Статус «Готов к выдаче» выключен в настройках сезона");
    await setStatus(tx, o, "ready", actor);
  });

export type PaymentInput = { amount: number; method: PayMethod; paid: boolean; invoiceRef: string; note: string };

// Spec §5.3 «Отметить оплату»: a paid payment, or a Kaspi invoice issued and awaited (pending)
export const recordPayment = (orderId: string, p: PaymentInput, actor: Actor) =>
  mutate(orderId, async (tx, o) => {
    if (!PAYABLE.includes(o.status)) fail(`Заказ в статусе «${STATUS_LABEL[o.status]}» — оплату не принять`);
    if (!Number.isInteger(p.amount) || p.amount <= 0) fail("Сумма — целое число тенге больше нуля");
    o = await reprice(tx, o, actor);
    const m = money(o.total, o.prepaymentPct, await paysOf(tx, o.id));
    if (p.amount > m.balance) fail(`Сумма больше остатка к оплате (${tenge(m.balance)})`);
    const now = new Date();
    const [pay] = await tx
      .insert(payments)
      .values({
        orderId: o.id,
        kind: o.status === "confirmed" ? "prepayment" : "balance",
        method: p.method,
        status: p.paid ? "paid" : "pending",
        amount: p.amount,
        invoiceRef: p.invoiceRef || null,
        paidAt: p.paid ? now : null,
        recordedBy: actor.id,
        note: p.note,
      })
      .returning();
    await log(tx, o.id, actor, "payment", { payload: { paymentId: pay.id, amount: pay.amount, method: pay.method, status: pay.status, invoiceRef: pay.invoiceRef } });
    if (p.paid) await syncPrepaid(tx, o, actor);
  });

async function orderOfPayment(paymentId: string) {
  const [p] = await db.select({ orderId: payments.orderId }).from(payments).where(eq(payments.id, paymentId));
  return p?.orderId;
}

// The awaited Kaspi invoice got paid. Money is a fact, so it's accepted in any status but cancelled.
export async function markInvoicePaid(paymentId: string, actor: Actor) {
  const orderId = await orderOfPayment(paymentId);
  if (!orderId) return { ok: false as const, error: "Счёт не найден" };
  return mutate(orderId, async (tx, o) => {
    if (o.status === "cancelled") fail("Заказ отменён");
    const [p] = await tx
      .update(payments)
      .set({ status: "paid", paidAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
      .returning();
    if (!p) fail("Счёт уже закрыт");
    await log(tx, o.id, actor, "payment", { payload: { paymentId, amount: p.amount, method: p.method, status: "paid", invoiceRef: p.invoiceRef } });
    await syncPrepaid(tx, await reprice(tx, o, actor), actor);
  });
}

export async function cancelInvoice(paymentId: string, actor: Actor) {
  const orderId = await orderOfPayment(paymentId);
  if (!orderId) return { ok: false as const, error: "Счёт не найден" };
  return mutate(orderId, async (tx, o) => {
    const [p] = await tx
      .update(payments)
      .set({ status: "cancelled" })
      .where(and(eq(payments.id, paymentId), eq(payments.status, "pending")))
      .returning();
    if (!p) fail("Счёт уже закрыт");
    await log(tx, o.id, actor, "payment", { payload: { paymentId, amount: p.amount, status: "cancelled" } });
  });
}

// Spec §5.5 «Выдача». Full: the balance, if any, is taken right now, then issued (spec §9).
// Partial: `packs` per order line handed out now; the order keeps its status and its whole reserve.
export const issueOrder = (orderId: string, method: PayMethod | null, actor: Actor, packs?: Record<string, number>) =>
  mutate(orderId, async (tx, o, season) => {
    if (o.status === "confirmed" && !season.settings.issue_on_full_payment_allowed) fail("Выдача без предоплаты выключена в настройках сезона");
    if (!["confirmed", "prepaid", "ready"].includes(o.status)) fail(`Заказ в статусе «${STATUS_LABEL[o.status]}» не выдать`);
    if (packs) {
      const now = (await itemRows(tx, o.id)).map((i) => {
        const n = packs[i.id] ?? 0;
        const rest = (i.qtyStems - i.issuedStems) / i.packSize;
        if (!Number.isInteger(n) || n < 0 || n > rest) fail(`${i.substituteName ?? i.name}: можно выдать от 0 до ${rest} пач.`);
        return { i, n };
      });
      if (!now.some((x) => x.n)) fail("Укажите, сколько пачек выдали");
      // whatever is left is handed out now: that is a full issue
      if (now.some(({ i, n }) => i.issuedStems + n * i.packSize < i.qtyStems)) {
        if (o.status === "confirmed") fail("Без предоплаты заказ выдаётся только целиком, с полной оплатой");
        for (const { i, n } of now.filter((x) => x.n)) await tx.update(orderItems).set({ issuedStems: i.issuedStems + n * i.packSize }).where(eq(orderItems.id, i.id));
        await log(tx, o.id, actor, "edit", { payload: { issued: now.filter((x) => x.n).map(({ i, n }) => `${i.substituteName ?? i.name} ${n} пач.`).join(", ") } });
        return;
      }
    }
    o = await reprice(tx, o, actor);
    const m = money(o.total, o.prepaymentPct, await paysOf(tx, o.id));
    if (m.balance > 0) {
      if (!method) fail(`Сначала примите остаток: ${tenge(m.balance)}`);
      const [pay] = await tx
        .insert(payments)
        .values({ orderId: o.id, kind: "balance", method, status: "paid", amount: m.balance, paidAt: new Date(), recordedBy: actor.id, note: "при выдаче" })
        .returning();
      await log(tx, o.id, actor, "payment", { payload: { paymentId: pay.id, amount: pay.amount, method, status: "paid" } });
      o = await syncPrepaid(tx, o, actor);
    }
    await tx.update(orderItems).set({ issuedStems: sql`${orderItems.qtyStems}` }).where(eq(orderItems.orderId, o.id));
    await setStatus(tx, o, "issued", actor, { issuedAt: new Date() });
  });

// «Не приехал» (spec §5.5): a line in the journal, the order stays as it is
export const noShow = (orderId: string, day: string, actor: Actor) =>
  mutate(orderId, async (tx, o) => {
    await log(tx, o.id, actor, "note", { payload: { noShow: day } });
  });

const EDITABLE: Status[] = ["new", "confirmed", "prepaid", "ready"];

export const setDiscount = (orderId: string, amount: number, reason: string, actor: Actor) =>
  mutate(orderId, async (tx, o) => {
    if (actor.role !== "owner") fail("Скидку даёт только владелец");
    if (["issued", "cancelled"].includes(o.status)) fail("Заказ закрыт");
    if (!Number.isInteger(amount) || amount < 0 || amount > o.subtotal) fail(`Скидка — от 0 до ${tenge(o.subtotal)}`);
    if (amount > 0 && !reason.trim()) fail("Укажите причину скидки");
    const [n] = await tx
      .update(orders)
      .set({ discountAmount: amount, discountReason: amount ? reason.trim() : null, total: o.subtotal - amount })
      .where(eq(orders.id, o.id))
      .returning();
    await log(tx, o.id, actor, "edit", { payload: { discount: { from: o.discountAmount, to: amount }, reason: reason.trim() } });
    await syncPrepaid(tx, n, actor);
  });

export type ItemsEdit = { existing: { itemId: string; qtyPacks: number }[]; added: { productId: string; qtyPacks: number }[] };

// «Изменить состав». After the price is locked, extra packs go as a new line at today's grid price (spec §9).
export const editItems = (orderId: string, edit: ItemsEdit, actor: Actor) =>
  mutate(orderId, async (tx, o, season) => {
    if (actor.role !== "owner") fail("Состав меняет только владелец");
    if (!EDITABLE.includes(o.status)) fail(`Заказ в статусе «${STATUS_LABEL[o.status]}» не изменить`);
    const items = await itemRows(tx, o.id);
    const all = await tulips(tx);
    const locked = !!o.priceLockedAt;
    const added = edit.added.filter((a) => a.qtyPacks > 0);
    const changed: { item: ItemRow; qtyPacks: number }[] = [];
    for (const e of edit.existing) {
      const item = items.find((i) => i.id === e.itemId) ?? fail("Строка заказа не найдена");
      if (!Number.isInteger(e.qtyPacks) || e.qtyPacks < 0) fail("Количество — целое число пачек");
      if (e.qtyPacks === item.qtyPacks) continue;
      if (locked && e.qtyPacks > item.qtyPacks) added.push({ productId: item.productId, qtyPacks: e.qtyPacks - item.qtyPacks });
      else changed.push({ item, qtyPacks: e.qtyPacks });
    }
    if (!changed.length && !added.length) fail("Состав не изменился");

    const newLines = added.map((a) => {
      const p = all.find((x) => x.id === a.productId && x.isActive) ?? fail("Цвет не найден или выключен");
      return { productId: p.id, tulipType: p.tulipType as TulipType, qtyPacks: a.qtyPacks, packSize: p.packSize, name: p.name };
    });
    const after = [
      ...items
        .map((i) => ({ i, qtyPacks: changed.find((c) => c.item.id === i.id)?.qtyPacks ?? i.qtyPacks }))
        .filter((x) => x.qtyPacks > 0)
        .map(({ i, qtyPacks }) => ({ ...i, qtyPacks, qtyStems: qtyPacks * i.packSize, tulipType: i.tulipType as TulipType })),
      ...newLines.map((l) => ({ ...l, qtyStems: l.qtyPacks * l.packSize, substituteProductId: null, substituteName: null })),
    ];
    const problems = orderProblems({
      lines: after,
      settings: season.settings,
      pct: o.prepaymentPct,
      pickupDate: null, // pickup fields don't change here
      pickupTime: null,
      pickupFrom: season.pickupFrom,
      pickupTo: season.pickupTo,
    });
    if (problems.length) fail(problems.join(". "));
    if (RESERVING.includes(o.status)) await checkStock(tx, o, stockLines(after));

    const priced = priceLines(newLines, await seasonRules(o.seasonId, tx), almatyDay(new Date()), o.prepaymentPct);
    if (priced.missing.length) fail("Нет цены на сегодня для добавленных строк — проверьте сетку цен");
    for (const { item, qtyPacks } of changed) {
      if (qtyPacks === 0) await tx.delete(orderItems).where(eq(orderItems.id, item.id));
      else
        await tx
          .update(orderItems)
          .set({ qtyPacks, qtyStems: qtyPacks * item.packSize, lineTotal: qtyPacks * item.packSize * item.unitPrice })
          .where(eq(orderItems.id, item.id));
    }
    if (priced.lines.length)
      await tx.insert(orderItems).values(
        priced.lines.map((l) => ({
          orderId: o.id,
          productId: l.productId!,
          qtyPacks: l.qtyPacks,
          packSize: l.packSize,
          qtyStems: l.qtyStems,
          unitPrice: l.unitPrice,
          priceRuleId: l.priceRuleId,
          lineTotal: l.lineTotal,
        })),
      );
    const summary = (xs: { name: string; qtyPacks: number }[]) => xs.map((x) => `${x.name} ${x.qtyPacks}`).join(", ");
    let n = await retotal(tx, o);
    await log(tx, o.id, actor, "edit", { payload: { items: { from: summary(items), to: summary(after) }, totalFrom: o.total, totalTo: n.total } });
    n = await reprice(tx, n, actor);
    await syncPrepaid(tx, n, actor);
  });

// «Замена цвета»: only to a color of the same type; the reserve moves to the substitute
export async function substituteItem(itemId: string, substituteId: string | null, note: string, actor: Actor) {
  const [it] = await db.select({ orderId: orderItems.orderId }).from(orderItems).where(eq(orderItems.id, itemId));
  if (!it) return { ok: false as const, error: "Строка заказа не найдена" };
  return mutate(it.orderId, async (tx, o) => {
    if (!EDITABLE.includes(o.status)) fail(`Заказ в статусе «${STATUS_LABEL[o.status]}» не изменить`);
    const items = await itemRows(tx, o.id);
    const item = items.find((i) => i.id === itemId)!;
    let sub: { id: string; name: string } | null = null;
    if (substituteId) {
      const [p] = await tx.select().from(products).where(eq(products.id, substituteId));
      if (!p || !p.isActive || p.id === item.productId || p.tulipType !== item.tulipType) fail("Замена — только на другой цвет того же типа");
      sub = p;
    }
    const after = items.map((i) => (i.id === itemId ? { ...i, substituteProductId: sub?.id ?? null, substituteName: sub?.name ?? null } : i));
    if (RESERVING.includes(o.status)) await checkStock(tx, o, stockLines(after));
    await tx
      .update(orderItems)
      .set({ substituteProductId: sub?.id ?? null, substitutionNote: sub ? note.trim() || null : null })
      .where(eq(orderItems.id, itemId));
    await log(tx, o.id, actor, "edit", { payload: { substitution: { item: item.name, from: item.substituteName, to: sub?.name ?? null, note: note.trim() } } });
  });
}

export async function setInternalComment(orderId: string, text: string) {
  await db.update(orders).set({ commentInternal: text }).where(eq(orders.id, orderId));
}

// ——— reads ———

// Order card (spec §5.3). Opening it reprices an unlocked order to today's grid.
export async function orderCard(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  await expireHolds();
  const exists = await run(() => db.transaction(async (tx) => void (await reprice(tx, await lockOrder(tx, id), null))));
  if (!exists.ok) return null;
  const [row] = await db.select().from(orders).innerJoin(clients, eq(clients.id, orders.clientId)).where(eq(orders.id, id));
  const [items, pays, events, season] = await Promise.all([
    itemRows(db, id),
    paysOf(db, id),
    db
      .select({ e: orderEvents, actor: users.name })
      .from(orderEvents)
      .leftJoin(users, eq(users.id, orderEvents.actorId))
      .where(eq(orderEvents.orderId, id))
      .orderBy(desc(orderEvents.createdAt)),
    getSeason(row.orders.seasonId),
  ]);
  return { order: row.orders, client: row.clients, items, payments: pays, events, season: season!, money: money(row.orders.total, row.orders.prepaymentPct, pays) };
}

export type OrderCardData = NonNullable<Awaited<ReturnType<typeof orderCard>>>;

// The order as the WhatsApp templates see it (lib/templates.ts)
export function orderView({ order: o, client, items, season, money: m }: OrderCardData): OrderView {
  return {
    number: o.number,
    lines: items.map((i) => ({ name: i.substituteName ?? i.name, qtyPacks: i.qtyPacks, packSize: i.packSize, unitPrice: i.unitPrice, lineTotal: i.lineTotal })),
    discount: o.discountAmount,
    total: o.total,
    pct: o.prepaymentPct,
    prepayment: m.prepayment,
    prepaymentDue: m.prepaymentDue,
    balance: m.balance,
    phone: prettyPhone(client.phone),
    holdUntil: o.status === "confirmed" ? o.holdUntil : null,
    pickupDate: o.pickupDate,
    pickupTime: o.pickupTime,
    pickupMethod: o.pickupMethod,
    pickupHours: hoursFor(season.settings, o.pickupDate),
  };
}

const paidSql = sql<number>`coalesce((select sum(case when p.kind = 'refund' then -p.amount else p.amount end) from payments p where p.order_id = ${orders.id} and p.status = 'paid'), 0)::int`;
export const packsSql = sql<number>`coalesce((select sum(i.qty_packs) from order_items i where i.order_id = ${orders.id}), 0)::int`;

// Spec §5.4: by default active orders, nearest deadline first (hold, then pickup)
export async function orderList(f: { seasonId: string; statuses: Status[]; q: string; pickupDate?: string }) {
  await expireHolds();
  const q = f.q.trim();
  const digits = q.replace(/\D/g, "");
  return db
    .select({
      id: orders.id,
      number: orders.number,
      status: orders.status,
      total: orders.total,
      prepaymentPct: orders.prepaymentPct,
      holdUntil: orders.holdUntil,
      pickupDate: orders.pickupDate,
      pickupTime: orders.pickupTime,
      pickupMethod: orders.pickupMethod,
      storageRequested: orders.storageRequested,
      paid: paidSql,
      packs: packsSql,
      name: clients.name,
      company: clients.company,
      phone: clients.phone,
    })
    .from(orders)
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(
      and(
        eq(orders.seasonId, f.seasonId),
        f.statuses.length ? inArray(orders.status, f.statuses) : undefined,
        f.pickupDate ? eq(orders.pickupDate, f.pickupDate) : undefined,
        q
          ? or(
              ilike(orders.number, `%${q}%`),
              ilike(clients.name, `%${q}%`),
              ilike(clients.company, `%${q}%`),
              digits.length >= 4 ? ilike(clients.phone, `%${digits}%`) : undefined,
            )
          : undefined,
      ),
    )
    // next deadline: a running hold, otherwise the pickup day (a prepaid order's old hold_until means nothing)
    .orderBy(
      sql`coalesce(case when ${orders.status} = 'confirmed' then ${orders.holdUntil} end, ${orders.pickupDate}::timestamptz) asc nulls last`,
      desc(orders.createdAt),
    );
}

export type OrderListRow = Awaited<ReturnType<typeof orderList>>[number];

// Spec §5.5: orders to hand out on `day` with their lines, by pickup time, then number
export async function issueList(seasonId: string, day: string, statuses: Status[], q: string) {
  const rows = (await orderList({ seasonId, statuses, q, pickupDate: day })).sort(
    (a, b) => (a.pickupTime ?? "99").localeCompare(b.pickupTime ?? "99") || a.number.localeCompare(b.number),
  );
  const items = rows.length ? await itemRows(db, rows.map((r) => r.id)) : [];
  return rows.map((r) => ({ ...r, items: items.filter((i) => i.orderId === r.id) }));
}

// «Счета выставлены»: Kaspi invoices still awaited, oldest first
export async function pendingInvoices(seasonId: string) {
  return db
    .select({
      id: payments.id,
      amount: payments.amount,
      invoiceRef: payments.invoiceRef,
      createdAt: payments.createdAt,
      orderId: orders.id,
      number: orders.number,
      name: clients.name,
      company: clients.company,
    })
    .from(payments)
    .innerJoin(orders, eq(orders.id, payments.orderId))
    .innerJoin(clients, eq(clients.id, orders.clientId))
    .where(and(eq(orders.seasonId, seasonId), eq(payments.status, "pending"), isNotNull(payments.orderId)))
    .orderBy(asc(payments.createdAt));
}
