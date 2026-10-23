// npm run db:seed — wipes the database and fills it with the spec §18 stubs. The numbers are fake on purpose.
import { eq, sql } from "drizzle-orm";
import { hashPassword } from "@/lib/password";
import { DEFAULT_SETTINGS } from "@/lib/settings";
import { db, pg } from "@/db";
import * as s from "@/db/schema";
import * as o from "@/services/orders";

const must = <T extends { ok: boolean }>(r: T) => {
  if (!r.ok) throw new Error(JSON.stringify(r));
  return r as Extract<T, { ok: true }>;
};

async function main() {
  if (process.env.NODE_ENV === "production") throw new Error("seed wipes the database — not in production");
  const password = process.env.SEED_OWNER_PASSWORD;
  if (!password) throw new Error("SEED_OWNER_PASSWORD is not set");

  await db.execute(
    sql`truncate users, clients, seasons, products, price_rules, stock_plans, stock_adjustments, orders, order_items, payments, order_events, conversations, messages cascade`,
  );

  const [owner] = await db.insert(s.users).values({ name: "Татьяна", role: "owner", login: "tatiana", passwordHash: await hashPassword(password) }).returning();
  const actor = { id: owner.id, role: "owner" as const };

  const [season] = await db
    .insert(s.seasons)
    .values({
      name: "Тюльпаны 2027",
      ordersOpenFrom: "2026-10-20",
      peakDate: "2027-03-08",
      pickupFrom: "2027-03-01",
      pickupTo: "2027-03-08",
      status: "open",
      settings: { ...DEFAULT_SETTINGS, peak_hours_from: "2027-03-05" },
    })
    .returning();

  const colors = [
    ["Красный классический", "classic", "red"],
    ["Жёлтый классический", "classic", "yellow"],
    ["Белый классический", "classic", "white"],
    ["Розовый классический", "classic", "pink"],
    ["Фиолетовый классический", "classic", "purple"],
    ["Оранжевый классический", "classic", "orange"],
    ["Розовый махровый", "double", "pink"],
    ["Белый махровый", "double", "white"],
  ] as const;
  const ps = await db
    .insert(s.products)
    .values(colors.map(([name, tulipType, color], i) => ({ name, tulipType, color, sortOrder: i + 1 })))
    .returning();
  const P = Object.fromEntries(ps.map((p) => [`${p.color}-${p.tulipType}`, p.id]));
  await db
    .insert(s.stockPlans)
    .values(ps.map((p) => ({ seasonId: season.id, productId: p.id, plannedStems: p.tulipType === "classic" ? 3000 : 900 })));

  // §18 grid stub: price per stem, ₸ — [classic, double] for bands 40–60 / 70–90 / 100
  const grid = [
    ["2026-10-20", "2026-12-31", [200, 300], [190, 290], [180, 280]],
    ["2027-01-01", "2027-01-31", [220, 330], [210, 320], [200, 310]],
    ["2027-02-01", "2027-02-20", [250, 370], [240, 360], [230, 350]],
    ["2027-02-21", "2027-03-08", [300, 450], [290, 440], [280, 430]],
  ] as const;
  const bands = [
    [40, 60],
    [70, 90],
    [100, 100],
  ];
  await db.insert(s.priceRules).values(
    grid.flatMap(([dateFrom, dateTo, ...prices]) =>
      prices.flatMap((pair, b) =>
        (["classic", "double"] as const).map((tulipType, t) => ({
          seasonId: season.id,
          tulipType,
          dateFrom,
          dateTo,
          prepaymentMinPct: bands[b][0],
          prepaymentMaxPct: bands[b][1],
          pricePerStem: pair[t],
        })),
      ),
    ),
  );

  const shops = [
    ["Айгуль", "Цветы на Абая"],
    ["Марина", "Флора-Центр"],
    ["Ерлан", "ИП Бекжанов"],
    ["Светлана", "Букет-Сити"],
    ["Дана", "Tulip Room"],
  ];
  await db.insert(s.clients).values([
    ...shops.map(([name, company], i) => ({ phone: `+7777000000${i + 1}`, name, company, source: "import" as const })),
    { phone: "+77770000006", name: "Алия", company: "Green Studio", clientType: "landscaper" as const, source: "import" as const },
    { phone: "+77770000007", source: "inbound_message" as const },
  ]);

  const order = (n: number, lines: [string, number][], extra: Partial<o.NewOrder> = {}) =>
    o.createOrder(
      {
        phone: `+7777000000${n}`,
        name: "",
        company: "",
        lines: lines.map(([k, qtyPacks]) => ({ productId: P[k], qtyPacks })),
        pct: 40,
        pickupDate: "2027-03-06",
        pickupTime: null,
        pickupMethod: "self_pickup",
        storage: false,
        commentClient: "",
        commentInternal: "",
        channel: "whatsapp",
        ...extra,
      },
      actor,
    ).then(must);

  // new: ≥ 100 000 ₸, waits for Tatiana's check
  await order(1, [["red-classic", 20], ["white-double", 4]], { pickupDate: "2027-03-07", pickupTime: "09:00", storage: true });
  // confirmed: hold running, Kaspi invoice issued
  const c = await order(2, [["yellow-classic", 4], ["pink-double", 2]], { pct: 60 });
  must(await o.recordPayment(c.id, { amount: 10_000, method: "kaspi_invoice", paid: false, invoiceRef: "KSP-1001", note: "" }, actor));
  // prepaid + a color substitution
  const p = await order(3, [["pink-classic", 6]], { pct: 100, pickupTime: "14:30", pickupMethod: "client_truck" });
  must(await o.recordPayment(p.id, { amount: 32_400, method: "kaspi_invoice", paid: true, invoiceRef: "KSP-1002", note: "" }, actor));
  const [pItem] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, p.id));
  must(await o.substituteItem(pItem.id, P["purple-classic"], "розовых не хватило, согласовано по телефону", actor));
  // ready (the status is off by default in the season, switched on just for this)
  const r = await order(4, [["white-classic", 5]], { pct: 70, pickupDate: "2027-03-05" });
  must(await o.recordPayment(r.id, { amount: 20_000, method: "cash", paid: true, invoiceRef: "", note: "" }, actor));
  await db.update(s.seasons).set({ settings: { ...season.settings, ready_status_enabled: true } }).where(eq(s.seasons.id, season.id));
  must(await o.markReady(r.id, actor));
  await db.update(s.seasons).set({ settings: season.settings }).where(eq(s.seasons.id, season.id));
  // issued in full
  const i = await order(5, [["red-classic", 4]], { pickupDate: "2027-03-01" });
  must(await o.recordPayment(i.id, { amount: 9_600, method: "kaspi_invoice", paid: true, invoiceRef: "KSP-1003", note: "" }, actor));
  must(await o.issueOrder(i.id, "cash", actor));
  // partially issued: prepaid, half of the first line already taken
  const pi = await order(6, [["orange-classic", 4], ["yellow-classic", 2]], { pickupDate: "2027-03-02" });
  must(await o.recordPayment(pi.id, { amount: 14_400, method: "cash", paid: true, invoiceRef: "", note: "" }, actor));
  const [piItem] = await db.select().from(s.orderItems).where(eq(s.orderItems.orderId, pi.id)).limit(1);
  await db.update(s.orderItems).set({ issuedStems: 60 }).where(eq(s.orderItems.id, piItem.id));
  // expired: hold ran out without a prepayment
  const e = await order(1, [["purple-classic", 4]]);
  await db.update(s.orders).set({ holdUntil: new Date(Date.now() - 3_600_000) }).where(eq(s.orders.id, e.id));
  await o.expireHolds();
  // cancelled
  const x = await order(3, [["white-double", 4]]);
  must(await o.cancelOrder(x.id, "магазин закрывается на ремонт", actor));

  // two dialogs: inbound, outbound from the CRM with a template, and an echo from Tatiana's phone
  const clientsByPhone = Object.fromEntries((await db.select().from(s.clients)).map((cl) => [cl.phone, cl.id]));
  const now = Date.now();
  const at = (minAgo: number) => new Date(now - minAgo * 60_000);
  for (const [phone, msgs] of [
    [
      "+77770000002",
      [
        ["in", "client", "Здравствуйте! Сколько стоят жёлтые к 8 марта?", null, false, 180],
        ["out", "operator", "Guldala Tulpan, расчёт на 21.10: …", "quote", false, 170],
        ["out", "operator", "Да, жёлтые есть, держу для вас", null, true, 160],
      ],
    ],
    [
      "+77770000007",
      [
        ["in", "client", "Добрый день, вы оптом продаёте?", null, false, 60],
        ["out", "operator", "Да, от 120 шт, пачками по 30", null, true, 50],
      ],
    ],
  ] as const) {
    const [conv] = await db
      .insert(s.conversations)
      .values({ clientId: clientsByPhone[phone], channel: "whatsapp", externalId: phone.slice(1), lastMessageAt: at(msgs.at(-1)![5]), lastInboundAt: at(msgs[0][5]) })
      .returning();
    await db.insert(s.messages).values(
      msgs.map(([direction, author, text, templateKey, isEcho, ago], k) => ({
        conversationId: conv.id,
        direction,
        author,
        text,
        templateKey,
        isEcho,
        status: direction === "in" ? ("read" as const) : ("delivered" as const),
        externalMessageId: `seed-${phone}-${k}`,
        sentAt: at(ago),
        createdAt: at(ago),
      })),
    );
  }

  console.log(`seed done: login tatiana, ${ps.length} colors, 8 orders, 7 clients`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => pg.end());
