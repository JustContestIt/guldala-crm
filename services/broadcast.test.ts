// Integration: the client base (add, import, filters) and broadcasts against real Postgres, fake messaging provider
import { asc, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fakeProvider, type MessagingProvider } from "@/integrations/messaging";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("client base and broadcasts", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const cl = await import("./clients");
  const b = await import("./broadcast");

  beforeEach(async () => {
    await db.execute(sql`truncate clients, seasons, products, orders, order_items, conversations, messages cascade`);
    vi.stubEnv("WAZZUP_TEST_PHONES", "");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("imports a pasted table: new clients, empty fields filled, Tatiana's data kept, lines without a phone skipped", async () => {
    await db.insert(s.clients).values([
      { phone: "+77010000001", name: "Айгуль", company: "Цветы на Абая", source: "order" },
      { phone: "+77010000002", name: "", source: "inbound_message" },
    ]);
    const text = [
      "Телефон;Имя;Магазин", // header
      "+7 701 000 00 01; Другое имя; Другой магазин",
      "87010000002\tЕрлан\tРоза",
      "Дана +7 (701) 000-00-03",
      "8 701 000 00 04, , Тюльпан",
      "без телефона",
    ].join("\n");
    expect(await cl.importClients(text)).toEqual({ ok: true, added: 2, updated: 1, same: 1, skipped: 2 });
    const rows = await db.select().from(s.clients).orderBy(asc(s.clients.phone));
    expect(rows.map((r) => [r.phone, r.name, r.company, r.source])).toEqual([
      ["+77010000001", "Айгуль", "Цветы на Абая", "order"],
      ["+77010000002", "Ерлан", "Роза", "inbound_message"],
      ["+77010000003", "Дана", null, "import"],
      ["+77010000004", "", "Тюльпан", "import"], // an empty name cell keeps the shop in its column
    ]);
    expect(await cl.importClients("просто текст")).toMatchObject({ ok: false });
  });

  it("adds a client by hand once per phone", async () => {
    const r = await cl.createClient({ phone: "8 701 000 00 09", name: "Ерлан", company: "", clientType: "reseller", notes: "" });
    expect(r.ok).toBe(true);
    const again = await cl.createClient({ phone: "+77010000009", name: "Другой", company: "", clientType: "flower_shop", notes: "" });
    expect(again).toEqual({ ok: false, error: "Клиент с этим телефоном уже есть", id: r.ok ? r.id : "" });
    const [row] = await db.select().from(s.clients);
    expect(row).toMatchObject({ name: "Ерлан", clientType: "reseller", source: "manual", company: null });
  });

  it("filters the base by season orders and type, with orders and money per client", async () => {
    const [season] = await db
      .insert(s.seasons)
      .values({ name: "Тюльпаны 2027", ordersOpenFrom: "2026-10-20", peakDate: "2027-03-08", pickupFrom: "2027-03-01", pickupTo: "2027-03-08", status: "open", settings: DEFAULT_SETTINGS })
      .returning();
    const [a, c, d] = await db
      .insert(s.clients)
      .values([
        { phone: "+77010000001", name: "A", source: "order" },
        { phone: "+77010000002", name: "B", clientType: "reseller", source: "import" },
        { phone: "+77010000003", name: "C", source: "order" },
      ])
      .returning()
      .then((x) => [x[0], x[1], x[2]]);
    let n = 0;
    const order = (clientId: string, status: (typeof s.orders.$inferInsert)["status"], total: number) =>
      db.insert(s.orders).values({ number: `T-${++n}`, seasonId: season.id, clientId, status, createdBy: "operator", prepaymentPct: 40, subtotal: total, total });
    await order(a.id, "confirmed", 24_000);
    await order(a.id, "issued", 6_000);
    await order(d.id, "cancelled", 9_000); // a cancelled order is no order

    const all = await cl.clientList({ q: "" });
    expect(all.map((r) => [r.name, r.orders, r.spent])).toEqual([
      ["A", 2, 30_000],
      ["B", 0, 0],
      ["C", 0, 0],
    ]);
    expect((await cl.clientList({ q: "", seg: "season", seasonId: season.id })).map((r) => r.name)).toEqual(["A"]);
    expect((await cl.clientList({ q: "", seg: "none" })).map((r) => r.name)).toEqual(["B", "C"]);
    expect((await cl.clientList({ q: "", type: "reseller" })).map((r) => r.id)).toEqual([c.id]);
    const csv = cl.clientsCsv(all);
    expect(csv.startsWith("﻿Телефон;Имя;Магазин")).toBe(true);
    expect(csv).toContain("+77010000001;A;;Цветочный магазин;2;30000;");
  });

  it("sends a broadcast one by one with each client's name, and stops what is still queued", async () => {
    const [a, c] = await db
      .insert(s.clients)
      .values([
        { phone: "+77010000001", name: "Айгуль", company: "Цветы на Абая", source: "order" },
        { phone: "+77010000002", name: "", source: "inbound_message" },
      ])
      .returning();
    const sent: string[] = [];
    const provider: MessagingProvider = { ...fakeProvider, send: async (m) => (sent.push(`${m.chatId}: ${m.text}`), { messageId: `w-${sent.length}` }) };
    let pauses = 0;

    const r = await b.startBroadcast("Здравствуйте, {имя}! Открыли приём заказов.", [a.id, c.id, a.id]);
    expect(r).toMatchObject({ ok: true, count: 2 });
    if (!r.ok) return;
    await b.runBroadcast(r.key, provider, async () => void pauses++);
    // by name as in the list: the nameless client sorts by phone, before «Цветы на Абая»
    expect(sent).toEqual(["77010000002: Здравствуйте! Открыли приём заказов.", "77010000001: Здравствуйте, Айгуль! Открыли приём заказов."]);
    expect(pauses).toBe(2);
    const [row] = await b.broadcastList();
    expect(row).toMatchObject({ key: r.key, total: 2, sent: 2, queued: 0, failed: 0, running: false });
    const out = await db.select().from(s.messages).where(eq(s.messages.templateKey, r.key));
    expect(out.map((m) => [m.author, m.status])).toEqual([
      ["operator", "sent"],
      ["operator", "sent"],
    ]);

    // the test whitelist refuses others: «не ушло», and no pause for a send that never left
    vi.stubEnv("WAZZUP_TEST_PHONES", "+77010000001");
    const r2 = await b.startBroadcast("Второе", [a.id, c.id]);
    if (!r2.ok) throw new Error(r2.error);
    pauses = 0;
    const { messaging } = await import("@/integrations/messaging");
    await b.runBroadcast(r2.key, messaging(), async () => void pauses++);
    expect(pauses).toBe(1);
    expect((await b.broadcastFailures(r2.key)).map((f) => f.phone)).toEqual(["+77010000002"]);

    const r3 = await b.startBroadcast("Третье", [a.id, c.id]);
    if (!r3.ok) throw new Error(r3.error);
    expect(await b.stopBroadcast(r3.key)).toEqual({ ok: true, removed: 2 });
    expect(await db.select().from(s.messages).where(eq(s.messages.templateKey, r3.key))).toEqual([]);
    expect(await b.startBroadcast("  ", [a.id])).toMatchObject({ ok: false });
    expect(await b.startBroadcast("Текст", [])).toMatchObject({ ok: false });
  });
});
