// Integration: the site's endpoints against real Postgres (TEST_DATABASE_URL), fake messaging provider
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("public API", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const pub = await import("./public");
  const { POST } = await import("@/app/public/orders/route");

  let seasonId: string;
  let red: string;
  let pink: string;

  const post = (body: object, ip = "10.0.0.1") =>
    POST(new Request("http://crm/public/orders", { method: "POST", body: JSON.stringify(body), headers: { "x-forwarded-for": ip } }));
  const order = (items: { productId: string; packs: number }[], phone = "+77011111111", extra: object = {}) => ({
    items,
    prepaymentPct: 40,
    pickupDate: "2027-03-06",
    pickupSlot: "08:00–12:00",
    pickupMethod: "self",
    storage: false,
    client: { company: "Цветы на Абая", name: "Айгуль", phone, legalType: "ip", bin: "", orgName: "" },
    comment: "",
    source: "site",
    ...extra,
  });

  beforeEach(async () => {
    await db.execute(
      sql`truncate users, clients, seasons, products, price_rules, stock_plans, stock_adjustments, orders, order_items, payments, order_events, conversations, messages cascade`,
    );
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
      ])
      .returning();
    [red, pink] = ps.map((p) => p.id);
    await db.insert(s.stockPlans).values([
      { seasonId, productId: red, plannedStems: 150 }, // 5 packs
      { seasonId, productId: pink, plannedStems: 3000 },
    ]);
    await db.insert(s.priceRules).values([
      { seasonId, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-01-31", prepaymentMinPct: 40, prepaymentMaxPct: 90, pricePerStem: 200 },
      { seasonId, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-01-31", prepaymentMinPct: 100, prepaymentMaxPct: 100, pricePerStem: 180 },
      { seasonId, tulipType: "classic", dateFrom: "2027-02-01", dateTo: "2027-03-08", prepaymentMinPct: 40, prepaymentMaxPct: 100, pricePerStem: 250 },
    ]);
  });

  it("creates a confirmed order below the threshold, a new one above, and sends the booking", async () => {
    const res = await post(order([{ productId: pink, packs: 4 }]));
    expect(res.status).toBe(200);
    const r = await res.json();
    expect(r).toMatchObject({ orderNumber: "T-2027-0001", total: 24_000, prepaymentAmount: 9_600, pricesLockedAt: null });
    expect(r.holdUntil).not.toBeNull();
    const [o] = await db.select().from(s.orders);
    expect(o).toMatchObject({ status: "confirmed", channel: "site", createdBy: "client", publicToken: r.token });
    const [msg] = await db.select().from(s.messages);
    expect(msg).toMatchObject({ templateKey: "booking", status: "sent" });

    const big = await (await post(order([{ productId: pink, packs: 20 }], "+77011111112"), "10.0.0.2")).json(); // 120 000 ₸ ≥ 100 000
    const [n] = await db.select().from(s.orders).where(eq(s.orders.number, big.orderNumber));
    expect(n.status).toBe("new");
    expect(n.holdUntil).toBeNull();
  });

  it("refuses with a human text below the minimum and over stock, the client never gets a `new` order", async () => {
    expect(await (await post(order([{ productId: pink, packs: 3 }]), "10.0.0.3")).json()).toEqual({ error: "Минимальный заказ — 120 шт, сейчас 90" });
    const over = await post(order([{ productId: red, packs: 6 }]), "10.0.0.3");
    expect(over.status).toBe(400);
    expect((await over.json()).error).toBe("Не хватает: Красный классический — свободно 5 пач., запрошено 6");
    expect(await db.select().from(s.orders)).toHaveLength(0);
    expect((await post(order([{ productId: pink, packs: 4 }], "", { pickupDate: "" }), "10.0.0.3")).status).toBe(400);
  });

  it("limits one phone to 5 orders an hour", async () => {
    for (let i = 0; i < 5; i++) expect((await post(order([{ productId: pink, packs: 4 }], "+77012222222"), `10.0.1.${i}`)).status).toBe(200);
    const sixth = await post(order([{ productId: pink, packs: 4 }], "+77012222222"), "10.0.1.9");
    expect(sixth.status).toBe(429);
  });

  it("serves the order by its token with items and the story so far", async () => {
    const { token } = await (await post(order([{ productId: pink, packs: 4 }]), "10.0.0.4")).json();
    const o = (await pub.orderByToken(token))!;
    expect(o).toMatchObject({
      orderNumber: "T-2027-0001",
      status: "confirmed",
      prepaymentPct: 40,
      total: 24_000,
      paid: 0,
      prepaymentDue: 9_600,
      invoice: null,
      pickup: { date: "2027-03-06", slot: "08:00", method: "self", storage: false },
    });
    expect(o.items).toEqual([{ productId: pink, color: "pink", type: "classic", packs: 4, stems: 120, pricePerStem: 200, sum: 24_000 }]);
    expect(o.events.map((e) => e.type)).toEqual(["created"]);
    expect(await pub.orderByToken("00000000-0000-0000-0000-000000000000")).toBeNull();
  });

  it("season/current: prices at 100 %, the grid at the site's four points, stock minus reserves", async () => {
    await post(order([{ productId: red, packs: 4 }]), "10.0.0.5"); // 30 stems of red left
    const c = (await pub.seasonCurrent())!;
    expect(c.season).toMatchObject({ saleOpen: true, pickupFrom: "2027-03-01", pickupTo: "2027-03-08", peakHoursFrom: "2027-03-05" });
    expect(c.prices.classic).toEqual({ today: 180, next: { from: "2027-02-01", price: 250 } });
    expect(c.priceGrid.filter((r) => r.periodEnd === "2027-01-31" && r.type === "classic").map((r) => [r.prepaymentPct, r.pricePerStem])).toEqual([
      [40, 200],
      [60, 200],
      [80, 200],
      [100, 180],
    ]);
    expect(c.stock.find((x) => x.productId === red)).toMatchObject({ color: "red", type: "classic", status: "few", maxPacks: 1 }); // 30 < 30 % of 150
    expect(c.stock.find((x) => x.productId === pink)).toMatchObject({ status: "many", maxPacks: 100 });
  });

  it("prefill link: contacts by token, 404 after 30 days", async () => {
    await db.insert(s.clients).values({ phone: "+77013333333", name: "Айгуль", company: "Цветы на Абая", source: "import" });
    const r = await pub.createPrefill("+7 701 333 33 33");
    expect(r.ok).toBe(true);
    const token = r.ok ? r.url.split("?c=")[1] : "";
    expect(await pub.prefill(token)).toEqual({ client: { name: "Айгуль", company: "Цветы на Абая", phone: "+77013333333" } });
    await db.update(s.conversations).set({ prefillTokenAt: new Date(Date.now() - 31 * 86_400_000) });
    expect(await pub.prefill(token)).toBeNull();
    expect(await pub.prefill("nope")).toBeNull();
  });

  it("records a Botanica lead as a client with a note", async () => {
    expect(await pub.recordLead({ segment: "office", phone: "+77014444444", company: "Acme", message: "офис 120 м²" })).toEqual({ ok: true });
    await pub.recordLead({ segment: "designer", phone: "+77014444444", company: "", message: "" });
    const [c] = await db.select().from(s.clients);
    expect(c).toMatchObject({ company: "Acme", clientType: "other", source: "inbound_message" });
    expect(c.notes.split("\n")).toHaveLength(2);
    expect(c.notes).toContain("офис, Acme, офис 120 м²");
  });
});
