// Clients of spec §5.6: the list, the card and «брали в прошлом сезоне, в этом не заказывали»
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, orderItems, orders, products, seasons } from "@/db/schema";
import type { Season } from "./catalog";
import { packsSql } from "./orders";

export const CLIENT_TYPES = {
  flower_shop: "Цветочный магазин",
  reseller: "Перекупщик",
  landscaper: "Ландшафтный дизайнер",
  private: "Частное лицо",
  other: "Другое",
} as const;
export type ClientType = keyof typeof CLIENT_TYPES;

const byName = asc(sql`coalesce(nullif(${clients.company}, ''), nullif(${clients.name}, ''), ${clients.phone})`);

export async function clientList(q: string) {
  const s = q.trim();
  const digits = s.replace(/\D/g, "");
  return db
    .select({ id: clients.id, name: clients.name, company: clients.company, phone: clients.phone, clientType: clients.clientType })
    .from(clients)
    .where(s ? or(ilike(clients.name, `%${s}%`), ilike(clients.company, `%${s}%`), digits.length >= 4 ? ilike(clients.phone, `%${digits}%`) : undefined) : undefined)
    .orderBy(byName)
    .limit(200); // shortcut: first 200 by name, search finds the rest; page it past a few thousand clients
}

export async function previousSeason(cur: Season) {
  const [s] = await db.select().from(seasons).where(lt(seasons.peakDate, cur.peakDate)).orderBy(desc(seasons.peakDate)).limit(1);
  return s ?? null;
}

// clientId → "Красный классический 10 пач., …": what each client took (issued orders) in the season
export async function tookIn(seasonId: string, clientIds?: string[]) {
  const rows = await db
    .select({ clientId: orders.clientId, name: products.name, packs: sql<number>`sum(${orderItems.qtyPacks})::int` })
    .from(orderItems)
    .innerJoin(orders, eq(orders.id, orderItems.orderId))
    .innerJoin(products, eq(products.id, sql`coalesce(${orderItems.substituteProductId}, ${orderItems.productId})`))
    .where(and(eq(orders.seasonId, seasonId), eq(orders.status, "issued"), clientIds ? inArray(orders.clientId, clientIds) : undefined))
    .groupBy(orders.clientId, products.name, products.sortOrder)
    .orderBy(asc(products.sortOrder));
  const m = new Map<string, string>();
  for (const r of rows) m.set(r.clientId, [m.get(r.clientId), `${r.name} ${r.packs} пач.`].filter(Boolean).join(", "));
  return m;
}

// Took flowers last season, no live order (anything but expired / cancelled) this season; with the last season_open sent
export async function lapsedClients(cur: Season) {
  const prev = await previousSeason(cur);
  const took = prev ? await tookIn(prev.id) : new Map<string, string>();
  if (!took.size) return { prev, rows: [] };
  const rows = await db
    .select({
      id: clients.id,
      name: clients.name,
      company: clients.company,
      phone: clients.phone,
      writtenAt: sql<string | null>`(select max(m.created_at) from messages m join conversations c on c.id = m.conversation_id
        where c.client_id = clients.id and m.template_key = 'season_open' and m.status <> 'error')`,
    })
    .from(clients)
    .where(
      and(
        inArray(clients.id, [...took.keys()]),
        sql`not exists (select 1 from orders o where o.client_id = ${clients.id} and o.season_id = ${cur.id} and o.status not in ('expired', 'cancelled'))`,
      ),
    )
    .orderBy(byName);
  return { prev, rows: rows.map((r) => ({ ...r, took: took.get(r.id)! })) };
}

export async function clientCard(id: string) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return null;
  const [client] = await db.select().from(clients).where(eq(clients.id, id));
  if (!client) return null;
  const list = await db
    .select({ id: orders.id, number: orders.number, status: orders.status, total: orders.total, packs: packsSql, seasonId: seasons.id, season: seasons.name })
    .from(orders)
    .innerJoin(seasons, eq(seasons.id, orders.seasonId))
    .where(eq(orders.clientId, id))
    .orderBy(desc(seasons.peakDate), desc(orders.createdAt));
  return { client, orders: list };
}

export async function updateClient(id: string, patch: { name: string; company: string; clientType: ClientType; notes: string }) {
  const r = await db
    .update(clients)
    .set({ ...patch, company: patch.company || null })
    .where(eq(clients.id, id))
    .returning({ id: clients.id });
  return r.length ? { ok: true as const } : { ok: false as const, error: "Клиент не найден" };
}
