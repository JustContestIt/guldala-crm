// Integration: the order confirmation by e-mail (review 09.11.2026, К23, С9, С10) against real Postgres, test-mode mail
import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DEFAULT_SETTINGS } from "@/lib/settings";

const enabled = !!process.env.TEST_DATABASE_URL;

describe.skipIf(!enabled)("order confirmation by e-mail", async () => {
  const { db } = await import("@/db");
  const s = await import("@/db/schema");
  const pub = await import("./public");
  const o = await import("./orders");
  const { sendConfirmation } = await import("./confirmations");

  let actor: { id: string; role: "owner" };
  let pink: string;

  const site = (payNow: boolean, email = "Shop@Mail.kz", phone = "+77011111111") =>
    pub.createSiteOrder({
      items: [{ productId: pink, packs: 4 }], // 120 stems
      prepaymentPct: 40,
      payNow,
      pickupDate: "2027-03-06",
      pickupSlot: "08:00–12:00",
      pickupMethod: "self",
      storage: false,
      client: { company: "Цветы на Абая", name: "Айгуль", phone, email, legalType: "ip", bin: "", orgName: "" },
      comment: "",
      prefillToken: "",
    });
  const placed = async (r: Awaited<ReturnType<typeof site>>) => {
    if (!r.ok) throw new Error(r.error);
    return (await db.select().from(s.orders).where(eq(s.orders.number, r.orderNumber)))[0];
  };
  const mails = async (orderId: string) =>
    (await db.select().from(s.orderEvents).where(eq(s.orderEvents.orderId, orderId)).orderBy(s.orderEvents.createdAt)).filter((e) => e.payload.template === "mail");
  const statusOf = async (id: string) => (await db.select().from(s.orders).where(eq(s.orders.id, id)))[0].status;

  beforeEach(async () => {
    vi.stubEnv("SMTP_HOST", ""); // test mode whatever the local .env says
    vi.stubEnv("MAIL_TEST_TO", "");
    vi.stubEnv("WAZZUP_API_TOKEN", "");
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
        settings: { ...DEFAULT_SETTINGS, price_lock_on: "confirmed" },
      })
      .returning();
    [{ id: pink }] = await db.insert(s.products).values({ name: "Розовый классический", tulipType: "classic", color: "pink" }).returning();
    await db.insert(s.stockPlans).values({ seasonId: season.id, productId: pink, plannedStems: 3000 });
    await db.insert(s.priceRules).values([
      { seasonId: season.id, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-03-08", prepaymentMinPct: 40, prepaymentMaxPct: 90, pricePerStem: 200 },
      { seasonId: season.id, tulipType: "classic", dateFrom: "2026-01-01", dateTo: "2027-03-08", prepaymentMinPct: 100, prepaymentMaxPct: 100, pricePerStem: 180 },
    ]);
  });

  it("«Оплатить предоплату» on the site: «Бронь» awaiting the invoice and a letter; «Оплачено» → «Предоплачен» and a second one", async () => {
    const row = await placed(await site(true));
    expect(row.status).toBe("confirmed");
    const [pay] = await db.select().from(s.payments).where(eq(s.payments.orderId, row.id));
    expect(pay).toMatchObject({ status: "pending", method: "kaspi_invoice", amount: 9_600 });
    expect((await pub.orderByToken(row.publicToken))!).toMatchObject({ invoice: { amount: 9_600 }, options: [] });
    expect((await mails(row.id)).map((e) => [e.type, e.payload.to, e.payload.provider])).toEqual([["message_sent", "shop@mail.kz", "fake"]]);

    const paid = await o.markInvoicePaid(pay.id, actor);
    expect(paid.ok).toBe(true);
    expect(await statusOf(row.id)).toBe("prepaid");
    expect(await mails(row.id)).toHaveLength(2);
  });

  it("a booking without prepayment: «Новый» gets no letter, the confirmed one does, with the order at every %", async () => {
    const row = await placed(await site(false));
    expect(row.status).toBe("new");
    expect(await mails(row.id)).toHaveLength(0);

    expect((await o.confirmOrder(row.id, actor)).ok).toBe(true);
    expect(await mails(row.id)).toHaveLength(1);
    const page = (await pub.orderByToken(row.publicToken))!;
    expect(page.invoice).toBeNull();
    expect(page.options).toEqual([
      { pct: 40, total: 24_000, prepayment: 9_600 },
      { pct: 60, total: 24_000, prepayment: 14_400 },
      { pct: 80, total: 24_000, prepayment: 19_200 },
      { pct: 100, total: 21_600, prepayment: 21_600 },
    ]);
  });

  it("no e-mail: nothing goes, and «Отправить ещё раз» says why", async () => {
    const row = await placed(await site(false, ""));
    expect((await o.confirmOrder(row.id, actor)).ok).toBe(true);
    expect(await mails(row.id)).toHaveLength(0);
    expect(await sendConfirmation(row.id, actor)).toMatchObject({ ok: false, error: expect.stringContaining("нет почты") });
  });

  it("«Отправить ещё раз» sends again; MAIL_TEST_TO keeps other addresses unsent and the journal says so", async () => {
    const row = await placed(await site(true));
    expect(await sendConfirmation(row.id, actor)).toMatchObject({ ok: true, to: "shop@mail.kz" });
    vi.stubEnv("MAIL_TEST_TO", "nikita@example.com");
    expect((await sendConfirmation(row.id, actor)).ok).toBe(false);
    expect((await mails(row.id)).map((e) => e.type)).toEqual(["message_sent", "message_sent", "notification"]);
  });
});
