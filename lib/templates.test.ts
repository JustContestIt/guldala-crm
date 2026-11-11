import { describe, expect, it } from "vitest";
import { canMove } from "./status";
import { fillBroadcast, orderText, type OrderView } from "./templates";

const lines = [
  { name: "Красный классический", qtyPacks: 4, packSize: 30, unitPrice: 200, lineTotal: 24_000 },
  { name: "Белый махровый", qtyPacks: 2, packSize: 30, unitPrice: 300, lineTotal: 18_000 },
];

describe("orderText", () => {
  const o: OrderView = {
    number: "T-2027-0042",
    lines,
    discount: 0,
    storageDays: 0,
    storageFee: 0,
    total: 42_000,
    pct: 40,
    prepayment: 16_800,
    prepaymentDue: 16_800,
    balance: 42_000,
    paid: 0,
    invoice: 0,
    priceDay: "2026-10-21",
    phone: "+77770000001",
    holdUntil: new Date("2026-10-24T13:00:00Z"), // 18:00 in Almaty
    pickupDate: "2027-03-06",
    pickupTime: "14:30:00",
    pickupMethod: "self_pickup",
    pickupHours: "08:00–23:00",
  };

  it("confirms a hold with its deadline, the price day and the pickup (К31)", () => {
    const t = orderText("booking", o);
    expect(t).toContain("Подтверждение заказа T-2027-0042 от Guldala Tulpan, расчёт на 21.10.2026:");
    expect(t).toMatch(/Итого 42\s000\s₸\.\n/);
    expect(t).toMatch(/Бронь до 24\.10\.2026 18:00\. Чтобы её закрепить, внесите предоплату 40 % — 16\s800\s₸/);
    expect(t).toContain("Выдача 06.03.2027 14:30, самовывоз");
    expect(t).not.toContain("Холодильник");
  });

  it("an issued Kaspi invoice is awaited, not asked for again", () => {
    const t = orderText("booking", { ...o, invoice: 16_800 });
    expect(t).toMatch(/Счёт Kaspi на 16\s800\s₸ \(предоплата 40 %\) выставлен на номер \+77770000001, ожидается оплата\. Бронь до 24\.10\.2026 18:00\./);
    expect(t).not.toContain("внесите");
  });

  it("booking shows the fridge days and their cost", () => {
    expect(orderText("booking", { ...o, storageDays: 5, storageFee: 5_000, total: 47_000 })).toMatch(/Холодильник до вывоза: 5 дн\. — 5\s000\s₸\./);
  });

  it("booking of an unconfirmed order without date promises nothing", () => {
    const t = orderText("booking", { ...o, holdUntil: null, pickupDate: null, discount: 2_000 });
    expect(t).toContain("Проверю наличие и подтвержу бронь");
    expect(t).toContain("Дату выдачи согласуем");
    expect(t).toMatch(/Скидка 2\s000/);
  });

  it("booking of a prepaid order says what was taken and what is left", () => {
    const t = orderText("booking", { ...o, holdUntil: null, prepaymentDue: 0, paid: 16_800, balance: 25_200 });
    expect(t).toContain("Подтверждение заказа T-2027-0042");
    expect(t).toMatch(/Принята предоплата 40 % — 16\s800\s₸\. Остаток оплаты при выдаче — 25\s200\s₸\./);
    expect(t).not.toContain("Kaspi");
    expect(orderText("booking", { ...o, holdUntil: null, prepaymentDue: 0, paid: 42_000, balance: 0 })).toContain("Заказ оплачен полностью.");
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

describe("fillBroadcast", () => {
  const aigul = { name: "Айгуль", company: "Цветы на Абая" };
  const nobody = { name: "", company: null };
  it("puts the client's name and shop in, and drops them cleanly when unknown", () => {
    expect(fillBroadcast("Здравствуйте, {имя}! Для {магазин} — скидка.", aigul)).toBe("Здравствуйте, Айгуль! Для Цветы на Абая — скидка.");
    expect(fillBroadcast("Здравствуйте, {имя}!", nobody)).toBe("Здравствуйте!");
    expect(fillBroadcast("Привет {имя}!", nobody)).toBe("Привет!");
    expect(fillBroadcast("{имя}, добрый день!", nobody)).toBe("Добрый день!");
    expect(fillBroadcast("Открыли приём заказов.", aigul)).toBe("Открыли приём заказов.");
  });
});
