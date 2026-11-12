import { describe, expect, it } from "vitest";
import { confirmationLetter, type LetterOrder } from "./letters";

// tenge() groups thousands with a no-break space
const letter = (o: LetterOrder) => {
  const l = confirmationLetter(o);
  return { subject: l.subject, text: l.text.replace(/\u00a0/g, " ") };
};

const order: LetterOrder = {
  number: "T-2027-0042",
  name: "Айгуль",
  status: "confirmed",
  lines: [{ name: "Красные классика", qtyPacks: 10, packSize: 30, unitPrice: 600, lineTotal: 180_000 }],
  discount: 0,
  storageDays: 0,
  storageFee: 0,
  total: 180_000,
  pct: 40,
  prepayment: 72_000,
  prepaymentDue: 72_000,
  balance: 180_000,
  paid: 0,
  invoice: 0,
  priceDay: "2026-11-11",
  prepayOff: 0,
  phone: "+7 701 888 44 46",
  holdUntil: new Date("2026-11-14T13:00:00Z"), // 18:00 in Almaty
  pickupDate: "2027-03-05",
  pickupTime: "10:00:00",
  pickupMethod: "self_pickup",
  pickupHours: "08:00–20:00",
  options: [
    { pct: 40, total: 180_000, prepayment: 72_000 },
    { pct: 100, total: 165_000, prepayment: 165_000 },
  ],
  url: "https://guldala.tulpan.org/o/abc",
};

describe("confirmationLetter", () => {
  it("a booking lists every prepayment at the held prices and the hold deadline", () => {
    const { subject, text } = letter(order);
    expect(subject).toBe("Заказ T-2027-0042: бронь до 14.11.2026 18:00");
    expect(text).toContain("Здравствуйте, Айгуль!");
    expect(text).toContain("Цены по сетке на 11.11.2026 держим до этого срока:");
    expect(text).toContain("— предоплата 100 %: внести 165 000 ₸, заказ 165 000 ₸");
    expect(text).toContain("Итого: 180 000 ₸ при предоплате 40 %");
    expect(text).toContain("Выдача 05.03.2027 10:00, самовывоз");
    expect(text).toContain("https://guldala.tulpan.org/o/abc");
    expect(text).not.toContain("Скидка");
    expect(text).not.toMatch(/\n\n\n/);
  });

  it("a booking with an awaited Kaspi invoice says what is awaited instead of the options", () => {
    const { subject, text } = letter({ ...order, invoice: 72_000 });
    expect(subject).toBe("Заказ T-2027-0042: бронь, ожидаем оплату");
    expect(text).toContain("Ожидаем оплату счёта Kaspi на 72 000 ₸");
    expect(text).not.toContain("— предоплата 40 %");
    expect(text).toContain("Итого: 180 000 ₸\n");
  });

  it("a request from the site: «заявка получена», no options yet (review 12.11.2026, П2)", () => {
    const { subject, text } = letter({ ...order, status: "new", holdUntil: null, options: [] });
    expect(subject).toBe("Заказ T-2027-0042: заявка получена");
    expect(text).toContain("Мы получили вашу заявку на заказ T-2027-0042");
    expect(text).toContain("Проверим наличие и подтвердим бронь в WhatsApp на номер +7 701 888 44 46");
    expect(text).toContain("Итого: 180 000 ₸\n");
  });

  it("delivery has its own pickup line; a 100 % discount is named (review 12.11.2026, С3, Ц4)", () => {
    const { text } = letter({ ...order, pickupMethod: "delivery", prepayOff: 10 });
    expect(text).toContain("Доставка 05.03.2027 10:00: стоимость доставки определяется отдельно, по договорённости с продавцом.");
    expect(text).not.toContain("самовывоз");
    expect(text).toContain("Цены со скидкой 10 % за 100 % предоплату.");
  });

  it("prepaid: the money received and what is left to pay at pickup", () => {
    const { subject, text } = letter({ ...order, status: "prepaid", paid: 72_000, balance: 108_000, holdUntil: null, discount: 5_000 });
    expect(subject).toBe("Заказ T-2027-0042 оформлен, предоплата получена");
    expect(text).toContain("Принята предоплата 72 000 ₸");
    expect(text).toContain("Остаток оплаты при получении: 108 000 ₸");
    expect(text).toContain("Скидка: 5 000 ₸");
    expect(letter({ ...order, status: "prepaid", paid: 180_000, balance: 0 }).text).toContain("Заказ оплачен полностью.");
  });
});
