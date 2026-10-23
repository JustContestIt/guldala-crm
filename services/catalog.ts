// Season reference data: the open season, its price grid, tulip products and computed stock
import { and, asc, desc, eq, ne } from "drizzle-orm";
import { db, type Db } from "@/db";
import { orderItems, orders, priceRules, products, seasons, stockAdjustments, stockPlans } from "@/db/schema";
import { availableStems, RESERVING, type Rule, type StockInput, type TulipType } from "@/lib/calc";
import type { ProductOpt } from "@/lib/quote";

export type Season = typeof seasons.$inferSelect;
export type Product = typeof products.$inferSelect;

// The open season; without one, the latest by peak date (orders are then refused by the services)
export async function currentSeason(d: Db = db): Promise<Season | null> {
  const [s] = await d
    .select()
    .from(seasons)
    .orderBy(desc(eq(seasons.status, "open")), desc(seasons.peakDate))
    .limit(1);
  return s ?? null;
}

export async function getSeason(id: string, d: Db = db) {
  const [s] = await d.select().from(seasons).where(eq(seasons.id, id));
  return s ?? null;
}

export async function seasonRules(seasonId: string, d: Db = db): Promise<Rule[]> {
  const rows = await d
    .select()
    .from(priceRules)
    .where(eq(priceRules.seasonId, seasonId))
    .orderBy(asc(priceRules.tulipType), asc(priceRules.dateFrom), asc(priceRules.prepaymentMinPct));
  return rows.map((r) => ({ ...r, tulipType: r.tulipType as TulipType }));
}

export const tulips = (d: Db = db) =>
  d
    .select()
    .from(products)
    .where(eq(products.line, "tulpan"))
    .orderBy(asc(products.sortOrder), asc(products.name));

// Everything availableStems() needs for a season; `exceptOrderId` leaves one order out (when that order is being changed)
export async function stockInput(seasonId: string, d: Db = db, exceptOrderId?: string): Promise<StockInput> {
  const [plans, adjustments, items] = await Promise.all([
    d.select().from(stockPlans).where(eq(stockPlans.seasonId, seasonId)),
    d.select().from(stockAdjustments).where(eq(stockAdjustments.seasonId, seasonId)),
    d
      .select({
        productId: orderItems.productId,
        substituteProductId: orderItems.substituteProductId,
        qtyStems: orderItems.qtyStems,
        issuedStems: orderItems.issuedStems,
        status: orders.status,
      })
      .from(orderItems)
      .innerJoin(orders, eq(orders.id, orderItems.orderId))
      .where(and(eq(orders.seasonId, seasonId), exceptOrderId ? ne(orders.id, exceptOrderId) : undefined)),
  ]);
  return { plans, adjustments, items };
}

export const available = async (seasonId: string, d: Db = db, exceptOrderId?: string) =>
  availableStems(await stockInput(seasonId, d, exceptOrderId));

// Colors on sale with their free stems: what the calculator and the order form offer
export async function productOpts(seasonId: string): Promise<ProductOpt[]> {
  const [ps, free] = await Promise.all([tulips(), available(seasonId)]);
  return ps
    .filter((p) => p.isActive)
    .map((p) => ({ id: p.id, name: p.name, tulipType: p.tulipType as TulipType, packSize: p.packSize, freeStems: free.get(p.id) ?? 0 }));
}

// Per color: plan, adjustments, reserved, issued and free stems (settings now, «Сегодня» at stage 3)
export async function stockTable(seasonId: string) {
  const [input, ps] = await Promise.all([stockInput(seasonId), tulips()]);
  const free = availableStems(input);
  const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((a, x) => a + f(x), 0);
  return ps.map((p) => {
    const mine = input.items.filter((i) => (i.substituteProductId ?? i.productId) === p.id);
    return {
      product: p,
      planned: input.plans.find((x) => x.productId === p.id)?.plannedStems ?? null,
      adjusted: sum(input.adjustments.filter((a) => a.productId === p.id), (a) => a.deltaStems),
      reserved: sum(mine.filter((i) => RESERVING.includes(i.status)), (i) => i.qtyStems),
      issued: sum(mine.filter((i) => i.status === "issued"), (i) => i.issuedStems),
      available: free.get(p.id) ?? 0,
    };
  });
}

// Serialises everything that takes stock in a season (spec §9: SELECT … FOR UPDATE on stock_plans)
export async function lockStock(tx: Db, seasonId: string) {
  await tx.select().from(stockPlans).where(eq(stockPlans.seasonId, seasonId)).orderBy(asc(stockPlans.productId)).for("update");
}
