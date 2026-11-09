// Integration: real Postgres (TEST_DATABASE_URL), recreated by tests/db-setup.ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("products", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const { saveProduct, setPlans, setStockTotal } = await import("./settings");
  const { available } = await import("./catalog");

  it("adds a product with its stock in one go and refuses a second one on sale in the same color and type", async () => {
    await db.execute(sql`truncate users, seasons, products, stock_plans, stock_adjustments, orders, order_items cascade`);
    const [season] = await db
      .insert(s.seasons)
      .values({ name: "Тюльпаны 2027", ordersOpenFrom: "2026-10-20", peakDate: "2027-03-08", pickupFrom: "2027-03-01", pickupTo: "2027-03-08", status: "open", settings: DEFAULT_SETTINGS })
      .returning();
    const f = { name: "Жёлтый махровый", tulipType: "double" as const, color: "yellow" as const, varieties: "Cadenza", isActive: true, sortOrder: 1 };

    const r = await saveProduct(null, f);
    if (!r.ok) throw new Error(r.error);
    // an open season still takes a plan for a product that has none
    expect(await setPlans(season.id, new Map([[r.id, 10]]))).toEqual({ ok: true });
    expect((await available(season.id)).get(r.id)).toBe(10 * DEFAULT_SETTINGS.pack_size);

    expect(await saveProduct(null, { ...f, name: "Ещё жёлтый" })).toMatchObject({ ok: false });
    expect(await saveProduct(r.id, { ...f, varieties: "Cadenza, Monte Carlo" })).toEqual({ ok: true, id: r.id }); // itself is no twin
    expect(await saveProduct(null, { ...f, name: "Старый жёлтый", isActive: false })).toMatchObject({ ok: true }); // off sale may share
    expect(await saveProduct(null, { ...f, tulipType: "classic", name: "Жёлтый классический" })).toMatchObject({ ok: true });
  });

  it("sets a product's season total in packs: the plan first, then one adjustment by the difference with a reason", async () => {
    const [season] = await db.select().from(s.seasons);
    const [p] = await db.select().from(s.products).where(sql`${s.products.name} = 'Жёлтый классический'`);
    const [user] = await db.insert(s.users).values({ name: "Татьяна", role: "owner", login: "t-stock", passwordHash: "x" }).returning();
    const free = async () => (await available(season.id)).get(p.id);

    expect(await setStockTotal(season.id, p.id, 20, "", user.id)).toEqual({ ok: true }); // no plan yet: no reason needed
    expect(await free()).toBe(20 * p.packSize);
    expect(await setStockTotal(season.id, p.id, 25, "", user.id)).toMatchObject({ ok: false }); // a change needs a reason
    expect(await setStockTotal(season.id, p.id, 25, "пересчёт", user.id)).toEqual({ ok: true });
    expect(await setStockTotal(season.id, p.id, 23, "брак", user.id)).toEqual({ ok: true });
    expect(await setStockTotal(season.id, p.id, 23, "", user.id)).toEqual({ ok: true }); // same total: nothing to record
    expect(await free()).toBe(23 * p.packSize);
    const adj = await db.select().from(s.stockAdjustments).where(sql`${s.stockAdjustments.productId} = ${p.id}`);
    expect(adj.map((a) => a.deltaStems).sort()).toEqual([-2 * p.packSize, 5 * p.packSize].sort());
  });
});
