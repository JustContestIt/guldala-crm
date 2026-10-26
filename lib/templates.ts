// WhatsApp texts of spec §13. Drafts until Tatiana approves them; she can edit every text before sending.
import { dmy, dmyhm, hhmm, tenge } from "./format";

export type TLine = { name: string; qtyPacks: number; packSize: number; unitPrice: number; lineTotal: number };

// the greenhouse, as clients read it in every message (2GIS: go.2gis.com/OhBXy)
const PLACE = "с. Бесагаш, ул. Мамыр, 1";

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
    `Guldala Tulpan, расчёт на ${dmy(q.day)}:`,
    ...q.lines.map(line),
    `Итого: ${tenge(q.total)} при предоплате ${q.pct} % (${tenge(q.prepayment)}).`,
    q.validUntil && `Цена действует до ${dmy(q.validUntil)}, дальше по сетке дороже.`,
    `Минимальный заказ — ${q.minStems} шт. Самовывоз с теплицы, ${PLACE}, ${q.pickupHours}.`,
  ]
    .filter(Boolean)
    .join("\n");
}

export type OrderView = {
  number: string;
  lines: TLine[];
  discount: number;
  storageDays: number;
  storageFee: number; // the fridge until pickup, already in total
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
  const pickup = o.pickupDate ? `${dmy(o.pickupDate)}${o.pickupTime ? ` ${hhmm(o.pickupTime)}` : ""}` : null;
  switch (key) {
    case "booking":
      return [
        `Заказ ${o.number} принят.`,
        ...o.lines.map(line),
        o.discount > 0 && `Скидка ${tenge(o.discount)}.`,
        o.storageFee > 0 && `Холодильник до вывоза: ${o.storageDays} дн. — ${tenge(o.storageFee)}.`,
        `Итого ${tenge(o.total)}, предоплата ${o.pct} % — ${tenge(o.prepayment)}.`,
        o.prepaymentDue === 0
          ? "Предоплата получена, бронь закреплена."
          : o.holdUntil
            ? `Счёт Kaspi выставлю на номер ${o.phone}. Без предоплаты бронь держится до ${dmyhm(o.holdUntil)}.`
            : `Проверю наличие и подтвержу бронь, счёт Kaspi выставлю на номер ${o.phone}.`,
        pickup
          ? `Выдача ${pickup}, ${o.pickupMethod === "client_truck" ? "отгрузка в вашу машину" : "самовывоз"}, ${PLACE}.`
          : `Дату выдачи согласуем, самовывоз с теплицы, ${PLACE}.`,
      ]
        .filter(Boolean)
        .join("\n");
    case "payment_reminder":
      return `Напоминаю по заказу ${o.number}: бронь держится до ${o.holdUntil ? dmyhm(o.holdUntil) : "—"}. Предоплата ${tenge(o.prepaymentDue)} по счёту Kaspi. После срока цветы вернутся в продажу.`;
    case "pickup_reminder":
      return `Завтра ${pickup ?? ""} выдача заказа ${o.number}: ${short(o.lines)}. ${toPay(o.balance)}${o.balance > 0 ? " (нал или Kaspi)" : ""}. Теплица открыта ${o.pickupHours}. Нужно ли хранение в холодильнике?`;
    case "ready":
      return `Заказ ${o.number} собран и ждёт вас: ${short(o.lines)}. ${toPay(o.balance)}. Выдача ${o.pickupHours}, ${PLACE}.`;
  }
}

// season_open: to last season's clients, by hand, one at a time (spec §5.6, §12)
export const seasonOpenText = (year: string, took: string) =>
  `Здравствуйте! Guldala Tulpan открыли приём заказов на сезон ${year}. Сейчас цена ниже — чем позже заказ, тем дороже. В прошлом сезоне вы брали ${took}. Посчитать на этот год?`;

// The bot's first words in a chat, word for word (Nikita, 26.10.2026): set before the model's own answer
export const BOT_GREETING =
  "Здравствуйте! Это Guldala.tulpan, теплица голландских тюльпанов под Алматы.\n\nЗдесь можно узнать цены и наличие сортов, оформить или изменить заказ, задать вопрос об оплате и вывозе. Мы постараемся вам помочь.";

// Broadcast text for one client: «Здравствуйте, {имя}!» → «Здравствуйте, Айгуль!», or «Здравствуйте!» when the name is unknown
export const BROADCAST_VARS = ["{имя}", "{магазин}"] as const;
export function fillBroadcast(text: string, c: { name: string; company: string | null }) {
  const t = text
    .replace(/(,?\s*)\{(имя|магазин)\}/g, (_, before: string, k: string) => {
      const v = (k === "имя" ? c.name : (c.company ?? "")).trim();
      return v ? before + v : "";
    })
    .replace(/^[\s,]+/, "");
  return t.charAt(0).toUpperCase() + t.slice(1);
}
