// WhatsApp texts of spec §13. Drafts until Tatiana approves them; she can edit every text before sending.
import { dm, dmhm, hhmm, tenge } from "./format";

export type TLine = { name: string; qtyPacks: number; packSize: number; unitPrice: number; lineTotal: number };

const line = (l: TLine) => `— ${l.name}, ${l.qtyPacks} пач. × ${l.packSize} шт × ${tenge(l.unitPrice)} = ${tenge(l.lineTotal)}`;
const short = (lines: TLine[]) => lines.map((l) => `${l.name} ${l.qtyPacks} пач.`).join(", ");

export function quoteText(q: {
  day: string;
  lines: TLine[];
  total: number;
  pct: number;
  prepayment: number;
  validUntil: string | null;
  pickupHours: string;
  minStems: number;
}) {
  return [
    `Guldala Tulpan, расчёт на ${dm(q.day)}:`,
    ...q.lines.map(line),
    `Итого: ${tenge(q.total)} при предоплате ${q.pct} % (${tenge(q.prepayment)}).`,
    q.validUntil && `Цена действует до ${dm(q.validUntil)}, дальше по сетке дороже.`,
    `Минимальный заказ — ${q.minStems} шт. Самовывоз с теплицы, пос. Гулдала, ${q.pickupHours}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type OrderView = {
  number: string;
  lines: TLine[];
  discount: number;
  total: number;
  pct: number;
  prepayment: number; // full prepayment amount
  prepaymentDue: number; // what is still missing of it
  balance: number;
  phone: string;
  holdUntil: Date | null;
  pickupDate: string | null;
  pickupTime: string | null;
  pickupMethod: "self_pickup" | "client_truck";
  pickupHours: string;
};

export const ORDER_TEMPLATES = {
  booking: "Бронь принята",
  payment_reminder: "Напомнить о предоплате",
  pickup_reminder: "Накануне выдачи",
  ready: "Заказ собран",
} as const;
export type OrderTemplate = keyof typeof ORDER_TEMPLATES;

const toPay = (balance: number) => (balance > 0 ? `К доплате ${tenge(balance)}` : "Заказ оплачен полностью");

export function orderText(key: OrderTemplate, o: OrderView): string {
  const pickup = o.pickupDate ? `${dm(o.pickupDate)}${o.pickupTime ? ` ${hhmm(o.pickupTime)}` : ""}` : null;
  switch (key) {
    case "booking":
      return [
        `Заказ ${o.number} принят.`,
        ...o.lines.map(line),
        o.discount > 0 && `Скидка ${tenge(o.discount)}.`,
        `Итого ${tenge(o.total)}, предоплата ${o.pct} % — ${tenge(o.prepayment)}.`,
        o.prepaymentDue === 0
          ? "Предоплата получена, бронь закреплена."
          : o.holdUntil
            ? `Счёт Kaspi выставлю на номер ${o.phone}. Без предоплаты бронь держится до ${dmhm(o.holdUntil)}.`
            : `Проверю наличие и подтвержу бронь, счёт Kaspi выставлю на номер ${o.phone}.`,
        pickup
          ? `Выдача ${pickup}, ${o.pickupMethod === "client_truck" ? "отгрузка в вашу машину" : "самовывоз"}, пос. Гулдала.`
          : "Дату выдачи согласуем, самовывоз с теплицы, пос. Гулдала.",
      ]
        .filter(Boolean)
        .join("\n");
    case "payment_reminder":
      return `Напоминаю по заказу ${o.number}: бронь держится до ${o.holdUntil ? dmhm(o.holdUntil) : "—"}. Предоплата ${tenge(o.prepaymentDue)} по счёту Kaspi. После срока цветы вернутся в продажу.`;
    case "pickup_reminder":
      return `Завтра ${pickup ?? ""} выдача заказа ${o.number}: ${short(o.lines)}. ${toPay(o.balance)}${o.balance > 0 ? " (нал или Kaspi)" : ""}. Теплица открыта ${o.pickupHours}. Нужно ли хранение в холодильнике?`;
    case "ready":
      return `Заказ ${o.number} собран и ждёт вас: ${short(o.lines)}. ${toPay(o.balance)}. Выдача ${o.pickupHours}, пос. Гулдала.`;
  }
}
