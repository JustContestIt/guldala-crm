// Clients of spec §5.6: the base with filters, the card, adding and importing, «брали в прошлом сезоне, в этом не заказывали»
import { and, asc, desc, eq, ilike, inArray, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { clients, orderItems, orders, products, seasons } from "@/db/schema";
import { normalizePhone } from "@/lib/format";
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

export const CLIENT_SOURCES = { order: "из заказа", inbound_message: "написал в WhatsApp", import: "импорт", manual: "добавлен вручную" } as const;

// «Заказали в этом сезоне» / «без заказов»: a live order is anything but expired / cancelled
export const SEGMENTS = { season: "Заказали в этом сезоне", none: "Без заказов" } as const;
export type Segment = keyof typeof SEGMENTS;
export type ClientFilter = { q: string; type?: ClientType | null; seg?: Segment | null; seasonId?: string | null };

const live = sql`o.client_id = ${clients.id} and o.status not in ('expired', 'cancelled')`;

const byName = asc(sql`coalesce(nullif(${clients.company}, ''), nullif(${clients.name}, ''), ${clients.phone})`);

// The base: search by phone / name / shop, type and order filters; every client with their live orders and money
export async function clientList(f: ClientFilter, limit = 200) {
  const s = f.q.trim();
  const digits = s.replace(/\D/g, "");
  return db
    .select({
      id: clients.id,
      name: clients.name,
      company: clients.company,
      phone: clients.phone,
      clientType: clients.clientType,
      source: clients.source,
      notes: clients.notes,
      createdAt: clients.createdAt,
      orders: sql<number>`(select count(*) from orders o where ${live})::int`,
      spent: sql<number>`coalesce((select sum(o.total) from orders o where ${live}), 0)::int`,
      lastOrderAt: sql<string | null>`(select max(o.created_at) from orders o where ${live})`,
    })
    .from(clients)
    .where(
      and(
        s ? or(ilike(clients.name, `%${s}%`), ilike(clients.company, `%${s}%`), digits.length >= 4 ? ilike(clients.phone, `%${digits}%`) : undefined) : undefined,
        f.type ? eq(clients.clientType, f.type) : undefined,
        f.seg === "season" && f.seasonId ? sql`exists (select 1 from orders o where ${live} and o.season_id = ${f.seasonId})` : undefined,
        f.seg === "none" ? sql`not exists (select 1 from orders o where ${live})` : undefined,
      ),
    )
    .orderBy(byName)
    .limit(limit); // shortcut: the screen shows the first 200 by name, search narrows; page it past a few thousand clients
}

export type ClientInput = { phone: string; name: string; company: string; clientType: ClientType; notes: string };

// «+ Клиент»: by hand; a known phone is not a second client
export async function createClient(c: ClientInput) {
  const phone = normalizePhone(c.phone);
  if (!phone) return { ok: false as const, error: "Телефон: казахстанский номер, +7 и 10 цифр" };
  const [row] = await db
    .insert(clients)
    .values({ phone, name: c.name.trim(), company: c.company.trim() || null, clientType: c.clientType, notes: c.notes.trim(), source: "manual" })
    .onConflictDoNothing({ target: clients.phone })
    .returning({ id: clients.id });
  if (row) return { ok: true as const, id: row.id };
  const [known] = await db.select({ id: clients.id }).from(clients).where(eq(clients.phone, phone));
  return { ok: false as const, error: "Клиент с этим телефоном уже есть", id: known.id };
}

// A pasted table (Excel, Google Sheets, a phone's notes) or a CSV: one client per line, the phone in any column,
// then name and shop in the order they come. Known phones only get an empty name / shop filled; Tatiana's data stays.
const PHONE_IN_TEXT = /(?<!\d)(?:\+?7|8)[\s()-]*\d(?:[\s()-]*\d){9}(?!\d)/;
const cellsOf = (line: string) =>
  line
    .split(line.includes("\t") ? "\t" : line.includes(";") ? ";" : ",")
    .map((x) => x.trim().replace(/^"|"$/g, "").trim()); // empty cells keep their place: «телефон;;магазин»

export function parseClients(text: string) {
  const rows: { phone: string; name: string; company: string }[] = [];
  let skipped = 0;
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue;
    let cells = cellsOf(line);
    let phone = cells.map(normalizePhone).find(Boolean);
    if (phone) cells = cells.filter((x) => normalizePhone(x) !== phone);
    else {
      // «Айгуль +7 777 123 45 67»: the number inside a cell
      const m = PHONE_IN_TEXT.exec(line);
      phone = m ? normalizePhone(m[0]) : null;
      if (m) cells = cellsOf(line.replace(m[0], ""));
    }
    if (!phone) {
      skipped++; // a header or a line without a Kazakhstan number
      continue;
    }
    const [name = "", company = ""] = cells;
    rows.push({ phone, name: name.slice(0, 100), company: company.slice(0, 150) });
  }
  return { rows, skipped };
}

export async function importClients(text: string) {
  const { rows, skipped } = parseClients(text);
  if (!rows.length) return { ok: false as const, error: "Не нашли ни одного телефона +7… — проверьте текст" };
  let added = 0;
  let updated = 0;
  for (const r of rows) {
    const [row] = await db
      .insert(clients)
      .values({ phone: r.phone, name: r.name, company: r.company || null, source: "import" })
      .onConflictDoUpdate({
        target: clients.phone,
        set: { name: sql`coalesce(nullif(${clients.name}, ''), excluded.name)`, company: sql`coalesce(nullif(${clients.company}, ''), excluded.company)` },
        setWhere: sql`(${clients.name} = '' and excluded.name <> '') or (coalesce(${clients.company}, '') = '' and excluded.company is not null)`,
      })
      .returning({ fresh: sql<boolean>`xmax = 0` });
    if (row?.fresh) added++;
    else if (row) updated++;
  }
  return { ok: true as const, added, updated, same: rows.length - added - updated, skipped };
}

// «Выгрузить»: the same list as on screen, for Excel (semicolons, BOM so Cyrillic opens right)
export function clientsCsv(rows: Awaited<ReturnType<typeof clientList>>) {
  const cell = (v: string | number) => (/[";\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  const day = (d: Date | string | null) => (d ? new Date(d).toISOString().slice(0, 10) : "");
  const head = ["Телефон", "Имя", "Магазин", "Тип", "Заказов", "Сумма, ₸", "Последний заказ", "Откуда", "Добавлен", "Заметки"];
  const lines = rows.map((r) =>
    [r.phone, r.name, r.company ?? "", CLIENT_TYPES[r.clientType], r.orders, r.spent, day(r.lastOrderAt), CLIENT_SOURCES[r.source], day(r.createdAt), r.notes].map(cell).join(";"),
  );
  return "\uFEFF" + [head.join(";"), ...lines].join("\r\n");
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
