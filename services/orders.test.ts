// Integration: real Postgres (TEST_DATABASE_URL), recreated by tests/db-setup.ts
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("orders service", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const o = await import("./orders");
  const { sendMessage } = await import("./messages");
  const { available } = await import("./catalog");

  let actor: { id: string; role: "owner" };
  let seasonId: string;
  let red: string;
  let pink: string;
  let white: string;

  const base = {
    phone: "+77770000001",
    name: "Айгуль",
    company: "Цветы на Абая",
    pct: 40,
    pickupDate: null,
    pickupTime: null,
    pickupMethod: "self_pickup" as const,
    storage: false,
    commentClient: "",
    commentInternal: "",
    channel: "whatsapp" as const,
  };

  beforeEach(async () => {
    await db.execute(
      sql`truncate users, clients, seasons, products, price_rules, stock_plans, stock_adjustments, orders, order_items, payments, order_events, conversations, messages cascade`,
    );
    const [u] = await db.insert(s.users).values({ name: "Татьяна", role: "owner", login: "t", passwordHash: "x" }).returning();
    actor = { id: u.id, role: "owner" };
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
    seasonId = season.id;
    const ps = await db
      .insert(s.products)
      .values([
        { name: "Красный классический", tulipType: "classic", color: "red" },
        { name: "Розовый классический", tulipType: "classic", color: "pink" },
        { name: "Белый махровый", tulipType: "double", color: "white" },
      ])
      .returning();
    [red, pink, white] = ps.map((p) => p.id);
    await db.insert(s.stockPlans).values([
      { seasonId, productId: red, plannedStems: 150 }, // 5 packs: room for one 4-pack order only
      { seasonId, productId: pink, plannedStems: 3000 },
      { seasonId, productId: white, plannedStems: 900 },
    ]);
    await db.insert(s.priceRules).values([
      { seasonId, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-03-08", prepaymentMinPct: 40, prepaymentMaxPct: 90, pricePerStem: 200 },
      { seasonId, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-03-08", prepaymentMinPct: 100, prepaymentMaxPct: 100, pricePerStem: 180 },
      { seasonId, tulipType: "double", dateFrom: "2026-01-01", dateTo: "2027-03-08", prepaymentMinPct: 40, prepaymentMaxPct: 100, pricePerStem: 300 },
    ]);
  });

  const statusOf = async (id: string) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0].status;
  const ok = <T>(r: T & { ok: boolean }) => {
    if (!r.ok) throw new Error((r as unknown as { error: string }).error);
    return r as Extract<T, { ok: true }>;
  };

  it("two parallel orders don't take the same last flowers", async () => {
    const [a, b] = await Promise.all([
      o.createOrder({ ...base, lines: [{ productId: red, qtyPacks: 4 }] }, actor),
      o.createOrder({ ...base, phone: "+77770000002", lines: [{ productId: red, qtyPacks: 4 }] }, actor),
    ]);
    const statuses = [ok(a).status, ok(b).status].sort();
    expect(statuses).toEqual(["confirmed", "new"]);
    expect((await available(seasonId)).get(red)).toBe(30);
    // the `new` one can't be confirmed while the stock is taken
    const pending = ok(a).status === "new" ? ok(a) : ok(b);
    const r = await o.confirmOrder(pending.id, actor);
    expect(r).toEqual({ ok: false, error: "Не хватает: Красный классический — свободно 1 пач., запрошено 4" });
  });

  it("parallel confirms of two new orders keep the stock whole", async () => {
    // both start as `new` because of the threshold, then race to confirm
    await db.update(s.seasons).set({ settings: { ...DEFAULT_SETTINGS, peak_hours_from: "2027-03-05", check_threshold_amount: 1 } });
    const a = ok(await o.createOrder({ ...base, lines: [{ productId: red, qtyPacks: 4 }] }, actor));
    const b = ok(await o.createOrder({ ...base, lines: [{ productId: red, qtyPacks: 4 }] }, actor));
    expect([a.status, b.status]).toEqual(["new", "new"]);
    const results = await Promise.all([o.confirmOrder(a.id, actor), o.confirmOrder(b.id, actor)]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect((await available(seasonId)).get(red)).toBe(30);
  });

  it("numbers orders per season", async () => {
    const a = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor));
    const b = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor));
    expect([a.number, b.number]).toEqual(["T-2027-0001", "T-2027-0002"]);
  });

  it("keeps orders at or above the threshold as new", async () => {
    // 20 packs × 30 × 200 = 120 000 ₸ ≥ 100 000
    const r = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 20 }] }, actor));
    expect(r.status).toBe("new");
    const small = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor));
    expect(small.status).toBe("confirmed");
  });

  it("refuses orders below the minimum or without a price", async () => {
    const r = await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 3 }] }, actor);
    expect(r).toEqual({ ok: false, error: "Минимальный заказ — 120 шт, сейчас 90" });
    const r2 = await o.createOrder({ ...base, pct: 50, lines: [{ productId: white, qtyPacks: 4 }] }, actor);
    expect(r2.ok).toBe(true);
    await db.delete(s.priceRules).where(eq(s.priceRules.tulipType, "double"));
    const r3 = await o.createOrder({ ...base, lines: [{ productId: white, qtyPacks: 4 }] }, actor);
    expect(r3.ok).toBe(false);
  });

  it("goes confirmed → prepaid → issued with money and events", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor)); // 24 000 ₸, 40 % = 9 600
    expect(await statusOf(id)).toBe("confirmed");

    ok(await o.recordPayment(id, { amount: 5_000, method: "kaspi_invoice", paid: true, invoiceRef: "K1", note: "" }, actor));
    expect(await statusOf(id)).toBe("confirmed");
    ok(await o.recordPayment(id, { amount: 4_600, method: "kaspi_invoice", paid: false, invoiceRef: "K2", note: "" }, actor));
    expect(await statusOf(id)).toBe("confirmed"); // an issued invoice is not money yet
    const [inv] = await db.select().from(s.payments).where(eq(s.payments.status, "pending"));
    ok(await o.markInvoicePaid(inv.id, actor));
    expect(await statusOf(id)).toBe("prepaid");
    const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
    expect(order.priceLockedAt).not.toBeNull();

    expect((await o.recordPayment(id, { amount: 20_000, method: "cash", paid: true, invoiceRef: "", note: "" }, actor)).ok).toBe(false);
    expect((await o.issueOrder(id, null, actor)).ok).toBe(false); // balance 14 400 not taken
    ok(await o.issueOrder(id, "cash", actor));
    expect(await statusOf(id)).toBe("issued");
    const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
    expect(items[0].issuedStems).toBe(120);
    expect((await available(seasonId)).get(pink)).toBe(3000 - 120);

    const card = await o.orderCard(id);
    expect(card!.money).toMatchObject({ paid: 24_000, balance: 0, paidInFull: true });
    const changes = card!.events.filter((e) => e.e.type === "status_change").map((e) => e.e.toStatus);
    expect(changes).toEqual(["issued", "prepaid", "confirmed"]);
    expect((await o.cancelOrder(id, "передумали", actor)).ok).toBe(false);
  });

  it("voids an open balance invoice when the balance is taken at pickup", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor)); // 24 000 ₸
    ok(await o.recordPayment(id, { amount: 9_600, method: "kaspi_invoice", paid: true, invoiceRef: "", note: "" }, actor));
    ok(await o.recordPayment(id, { amount: 14_400, method: "kaspi_invoice", paid: false, invoiceRef: "K3", note: "" }, actor)); // balance invoice sent
    ok(await o.issueOrder(id, "cash", actor)); // …but the client paid cash at the gate
    const pays = await db.select().from(s.payments).where(eq(s.payments.orderId, id));
    expect(pays.find((p) => p.invoiceRef === "K3")!.status).toBe("cancelled");
    expect((await o.markInvoicePaid(pays.find((p) => p.invoiceRef === "K3")!.id, actor)).ok).toBe(false); // can't be paid twice
    expect((await o.orderCard(id))!.money).toMatchObject({ paid: 24_000, balance: 0 });
  });

  it("issues partly by lines, then the rest with the balance (spec §5.5)", async () => {
    // 6 packs × 30 × 200 = 36 000 ₸, prepayment 40 % = 14 400
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }, { productId: red, qtyPacks: 2 }] }, actor));
    ok(await o.recordPayment(id, { amount: 14_400, method: "cash", paid: true, invoiceRef: "", note: "" }, actor));
    const itemOf = async (productId: string) =>
      (await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id))).find((i) => i.productId === productId)!;
    const [p, r] = [await itemOf(pink), await itemOf(red)];

    expect((await o.issueOrder(id, null, actor, { [p.id]: 5 })).ok).toBe(false); // more than ordered
    expect((await o.issueOrder(id, null, actor, {})).ok).toBe(false); // nothing handed out
    ok(await o.issueOrder(id, null, actor, { [p.id]: 3 }));
    expect(await statusOf(id)).toBe("prepaid");
    expect([(await itemOf(pink)).issuedStems, (await itemOf(red)).issuedStems]).toEqual([90, 0]);
    expect((await available(seasonId)).get(pink)).toBe(3000 - 120); // the reserve still holds the whole line

    // the rest is a full issue: the balance comes first
    expect((await o.issueOrder(id, null, actor, { [p.id]: 1, [r.id]: 2 })).ok).toBe(false);
    ok(await o.issueOrder(id, "kaspi_invoice", actor, { [p.id]: 1, [r.id]: 2 }));
    expect(await statusOf(id)).toBe("issued");
    const card = await o.orderCard(id);
    expect(card!.money).toMatchObject({ paid: 36_000, paidInFull: true });
    expect(card!.events.map((e) => e.e.payload.issued).filter(Boolean)).toEqual(["Розовый классический 3 пач."]);
  });

  it("issues a confirmed order only whole with full payment, and logs a no-show", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor)); // confirmed, nothing paid
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
    expect(await o.issueOrder(id, "cash", actor, { [item.id]: 2 })).toEqual({ ok: false, error: "Без предоплаты заказ выдаётся только целиком, с полной оплатой" });
    ok(await o.noShow(id, "2027-03-06", actor));
    expect(await statusOf(id)).toBe("confirmed");
    ok(await o.issueOrder(id, "cash", actor));
    const card = await o.orderCard(id);
    expect(card!.order.status).toBe("issued");
    expect(card!.money).toMatchObject({ paid: 24_000, paidInFull: true });
    expect(card!.events.filter((e) => e.e.type === "note").map((e) => e.e.payload)).toEqual([{ noShow: "2027-03-06" }]);
  });

  it("expires a hold by itself and resumes it at today's price", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: red, qtyPacks: 5 }] }, actor));
    expect((await available(seasonId)).get(red)).toBe(0);
    await db.update(s.orders).set({ holdUntil: new Date(Date.now() - 1000) }).where(eq(s.orders.id, id));
    expect(await o.expireHolds()).toBe(1);
    expect(await statusOf(id)).toBe("expired");
    expect((await available(seasonId)).get(red)).toBe(150);
    expect((await o.recordPayment(id, { amount: 100, method: "cash", paid: true, invoiceRef: "", note: "" }, actor)).ok).toBe(false);

    await db.update(s.priceRules).set({ pricePerStem: 250 }).where(eq(s.priceRules.pricePerStem, 200));
    ok(await o.resumeOrder(id, actor));
    const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
    expect(order.status).toBe("confirmed");
    expect(order.total).toBe(150 * 250);
    expect(order.holdUntil!.getTime()).toBeGreaterThan(Date.now() + 2 * 86_400_000);
  });

  it("cancels with a reason and frees the stock", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: red, qtyPacks: 4 }] }, actor));
    expect((await o.cancelOrder(id, " ", actor)).ok).toBe(false);
    ok(await o.cancelOrder(id, "клиент передумал", actor));
    expect((await available(seasonId)).get(red)).toBe(150);
  });

  it("substitutes within one type and moves the reserve", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor));
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
    expect((await o.substituteItem(item.id, white, "", actor)).ok).toBe(false); // double for classic
    ok(await o.substituteItem(item.id, red, "розовых не хватило", actor));
    const m = await available(seasonId);
    expect([m.get(pink), m.get(red)]).toEqual([3000, 30]);
  });

  it("adds packs to a locked order at today's price as a new line", async () => {
    const { id } = ok(await o.createOrder({ ...base, pct: 100, lines: [{ productId: pink, qtyPacks: 4 }] }, actor)); // 180 ₸
    ok(await o.recordPayment(id, { amount: 21_600, method: "cash", paid: true, invoiceRef: "", note: "" }, actor));
    await db.update(s.priceRules).set({ pricePerStem: 190 }).where(eq(s.priceRules.pricePerStem, 180));
    const [item] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
    ok(await o.editItems(id, { existing: [{ itemId: item.id, qtyPacks: 6 }], added: [] }, actor));
    const items = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, id));
    expect(items.map((i) => [i.qtyPacks, i.unitPrice]).sort()).toEqual([
      [2, 190],
      [4, 180],
    ]);
    const [order] = await db.select().from(s.orders).where(eq(s.orders.id, id));
    expect(order.total).toBe(21_600 + 60 * 190);
  });

  it("sends a template through the provider and logs it", async () => {
    const { id } = ok(await o.createOrder({ ...base, lines: [{ productId: pink, qtyPacks: 4 }] }, actor));
    const sent: string[] = [];
    const r = await sendMessage(
      { phone: base.phone, text: "Заказ принят", templateKey: "booking", orderId: id },
      actor,
      { name: "test", send: async (m) => (sent.push(m.chatId), { messageId: "w-1" }) },
    );
    expect(r.ok).toBe(true);
    expect(sent).toEqual(["77770000001"]);
    const [msg] = await db.select().from(s.messages);
    expect(msg).toMatchObject({ status: "sent", externalMessageId: "w-1", templateKey: "booking", direction: "out" });

    const bad = await sendMessage({ phone: base.phone, text: "x", templateKey: "booking", orderId: id }, actor, {
      name: "test",
      send: async () => {
        throw new Error("channel offline");
      },
    });
    expect(bad.ok).toBe(false);
    const events = await db.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, id));
    expect(events.map((e) => e.type).sort()).toEqual(["message_sent", "notification", "status_change"]);
  });
});
