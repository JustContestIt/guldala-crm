import { describe, expect, it } from "vitest";
import { canMove } from "./status";
import { orderText, quoteText, type OrderView } from "./templates";

const lines = [
  { name: "Красный классический", qtyPacks: 4, packSize: 30, unitPrice: 200, lineTotal: 24_000 },
  { name: "Белый махровый", qtyPacks: 2, packSize: 30, unitPrice: 300, lineTotal: 18_000 },
];

describe("quoteText", () => {
  it("renders the spec §13 quote", () => {
    const t = quoteText({
      day: "2026-10-21",
      lines,
      total: 42_000,
      pct: 40,
      prepayment: 16_800,
      validUntil: "2026-12-31",
      pickupHours: "08:00–18:00",
      minStems: 120,
    });
    expect(t).toBe(
      [
        "Guldala Tulpan, расчёт на 21.10:",
        "— Красный классический, 4 пач. × 30 шт × 200 ₸ = 24 000 ₸",
        "— Белый махровый, 2 пач. × 30 шт × 300 ₸ = 18 000 ₸",
        "Итого: 42 000 ₸ при предоплате 40 % (16 800 ₸).",
        "Цена действует до 31.12, дальше по сетке дороже.",
        "Минимальный заказ — 120 шт. Самовывоз с теплицы, пос. Гулдала, 08:00–18:00.",
      ]
        .join("\n")
        .replace(/(\d) (\d)/g, "$1 $2")
        .replace(/ ₸/g, " ₸"),
    );
  });
});

describe("orderText", () => {
  const o: OrderView = {
    number: "T-2027-0042",
    lines,
    discount: 0,
    total: 42_000,
    pct: 40,
    prepayment: 16_800,
    prepaymentDue: 16_800,
    balance: 42_000,
    phone: "+77770000001",
    holdUntil: new Date("2026-10-24T13:00:00Z"), // 18:00 in Almaty
    pickupDate: "2027-03-06",
    pickupTime: "14:30:00",
    pickupMethod: "self_pickup",
    pickupHours: "08:00–23:00",
  };

  it("booking names the hold deadline and the pickup", () => {
    const t = orderText("booking", o);
    expect(t).toContain("Заказ T-2027-0042 принят.");
    expect(t).toContain("бронь держится до 24.10 18:00");
    expect(t).toContain("Выдача 06.03 14:30, самовывоз");
  });

  it("booking of an unconfirmed order without date promises nothing", () => {
    const t = orderText("booking", { ...o, holdUntil: null, pickupDate: null, discount: 2_000 });
    expect(t).toContain("Проверю наличие и подтвержу бронь");
    expect(t).toContain("Дату выдачи согласуем");
    expect(t).toMatch(/Скидка 2\s000/);
  });

  it("booking of a prepaid order doesn't ask for money again", () => {
    const t = orderText("booking", { ...o, holdUntil: null, prepaymentDue: 0 });
    expect(t).toContain("Предоплата получена");
    expect(t).not.toContain("Kaspi");
  });

  it("pickup reminder says when nothing is left to pay", () => {
    expect(orderText("pickup_reminder", { ...o, balance: 0 })).toContain("Заказ оплачен полностью");
    expect(orderText("ready", o)).toMatch(/К доплате 42\s000/);
  });
});

describe("canMove", () => {
  it("follows spec §7", () => {
    expect(canMove("new", "confirmed")).toBe(true);
    expect(canMove("confirmed", "prepaid")).toBe(true);
    expect(canMove("confirmed", "expired")).toBe(true);
    expect(canMove("expired", "confirmed")).toBe(true);
    expect(canMove("prepaid", "issued")).toBe(true);
    expect(canMove("ready", "issued")).toBe(true);
    expect(canMove("new", "prepaid")).toBe(false);
    expect(canMove("confirmed", "issued")).toBe(false);
    expect(canMove("expired", "cancelled")).toBe(false);
    expect(canMove("issued", "cancelled")).toBe(false);
    expect(canMove("cancelled", "confirmed")).toBe(false);
  });
});
