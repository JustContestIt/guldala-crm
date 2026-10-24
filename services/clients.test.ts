// Integration: real Postgres (TEST_DATABASE_URL), recreated by tests/db-setup.ts
import { sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fakeProvider } from "@/integrations/messaging";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("clients service", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const { lapsedClients } = await import("./clients");
  const { sendMessage } = await import("./messages");

  it("lists last season's clients without a live order this season", async () => {
    await db.execute(
      sql`truncate users, clients, seasons, products, price_rules, stock_plans, stock_adjustments, orders, order_items, payments, order_events, conversations, messages cascade`,
    );
    const season = (name: string, year: number, status: "open" | "closed") => ({
      name,
      ordersOpenFrom: `${year - 1}-10-20`,
      peakDate: `${year}-03-08`,
      pickupFrom: `${year}-03-01`,
      pickupTo: `${year}-03-08`,
      status,
      settings: DEFAULT_SETTINGS,
    });
    const [prev, cur] = await db.insert(s.seasons).values([season("Тюльпаны 2026", 2026, "closed"), season("Тюльпаны 2027", 2027, "open")]).returning();
    const [red] = await db.insert(s.products).values({ name: "Красный классический", tulipType: "classic", color: "red" }).returning();
    const cs = await db
      .insert(s.clients)
      .values(["A", "B", "C", "D", "E"].map((name, i) => ({ phone: `+7701000000${i}`, name, source: "import" as const })))
      .returning();
    const [a, b, c, d, e] = cs.map((x) => x.id);
    let n = 0;
    const order = async (clientId: string, seasonId: string, status: (typeof s.orders.$inferInsert)["status"], packs = 4) => {
      const [o] = await db
        .insert(s.orders)
        .values({ number: `T-${++n}`, seasonId, clientId, status, createdBy: "operator", prepaymentPct: 40, subtotal: packs * 6000, total: packs * 6000 })
        .returning();
      await db.insert(s.orderItems).values({ orderId: o.id, productId: red.id, qtyPacks: packs, packSize: 30, qtyStems: packs * 30, unitPrice: 200, lineTotal: packs * 6000 });
    };
    await order(a, prev.id, "issued");
    await order(a, prev.id, "issued", 2);
    await order(b, prev.id, "issued");
    await order(b, cur.id, "confirmed"); // ordered again
    await order(c, prev.id, "issued");
    await order(c, cur.id, "cancelled"); // a cancelled order is no order
    await order(d, prev.id, "cancelled"); // took nothing last season
    await order(e, cur.id, "new");

    const r = await lapsedClients(cur);
    expect(r.prev?.id).toBe(prev.id);
    expect(r.rows.map((x) => [x.name, x.took, x.writtenAt])).toEqual([
      ["A", "Красный классический 6 пач.", null],
      ["C", "Красный классический 4 пач.", null],
    ]);

    // season_open sent to A shows as written
    ok(await sendMessage({ phone: "+77010000000", text: "Здравствуйте!", templateKey: "season_open" }, null, { ...fakeProvider, send: async () => ({ messageId: "w" }) }));
    const after = await lapsedClients(cur);
    expect(after.rows.map((x) => !!x.writtenAt)).toEqual([true, false]);
  });
});

function ok<T extends { ok: boolean }>(r: T) {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r;
}
