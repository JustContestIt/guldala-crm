// WhatsApp texts of spec §13. Drafts until Tatiana approves them; she can edit every text before sending.
import { dmy, dmyhm, hhmm, tenge } from "./format";

export type TLine = { name: string; qtyPacks: number; packSize: number; unitPrice: number; lineTotal: number };

// the greenhouse, as clients read it in every message (2GIS: go.2gis.com/OhBXy)
export const PLACE = "с. Бесагаш, ул. Мамыр, 1";
// Delivery is by Yandex Delivery, its price agreed with the seller each time (review 12.11.2026, С3)
export const DELIVERY_NOTE = "стоимость доставки определяется отдельно, по договорённости с продавцом";

const line = (l: TLine) => `— ${l.name}, ${l.qtyPacks} пач. × ${l.packSize} шт × ${tenge(l.unitPrice)} = ${tenge(l.lineTotal)}`;
const short = (lines: TLine[]) => lines.map((l) => `${l.name} ${l.qtyPacks} пач.`).join(", ");

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
  paid: number;
  invoice: number; // a Kaspi invoice issued and still awaited, 0 if none
  priceDay: string; // the grid day the price is by: the lock day or today
  prepayOff: number; // % off for a 100 % prepayment well before pickup (review 12.11.2026, Ц2); 0 = none
  phone: string;
  holdUntil: Date | null; // only while the order is a running hold (`confirmed`)
  pickupDate: string | null;
  pickupTime: string | null;
  pickupMethod: "self_pickup" | "delivery";
  pickupHours: string;
};

export const ORDER_TEMPLATES = {
  booking: "Подтверждение",
  payment_reminder: "Напомнить о предоплате",
  pickup_reminder: "Накануне выдачи",
  ready: "Заказ собран",
} as const;
export type OrderTemplate = keyof typeof ORDER_TEMPLATES;

const toPay = (balance: number) => (balance > 0 ? `К доплате ${tenge(balance)}` : "Заказ оплачен полностью");

export function orderText(key: OrderTemplate, o: OrderView): string {
  const pickup = o.pickupDate ? `${dmy(o.pickupDate)}${o.pickupTime ? ` ${hhmm(o.pickupTime)}` : ""}` : null;
  switch (key) {
    case "booking": {
      // what happened, not a quote (review 09.11.2026, К31): a hold, an awaited invoice, a prepayment taken; `new` is only received
      const booked = o.prepaymentDue === 0 || !!o.holdUntil;
      const hold = o.holdUntil ? dmyhm(o.holdUntil) : "—";
      return [
        booked ? `Подтверждение заказа ${o.number} от Guldala Tulpan, расчёт на ${dmy(o.priceDay)}:` : `Заказ ${o.number} принят.`,
        ...o.lines.map(line),
        o.discount > 0 && `Скидка ${tenge(o.discount)}.`,
        o.storageFee > 0 && `Холодильник до вывоза: ${o.storageDays} дн. — ${tenge(o.storageFee)}.`,
        booked ? `Итого ${tenge(o.total)}.` : `Итого ${tenge(o.total)}, предоплата ${o.pct} % — ${tenge(o.prepayment)}.`,
        o.prepaymentDue === 0
          ? `Принята предоплата ${o.pct} % — ${tenge(o.paid)}. ${o.balance > 0 ? `Остаток оплаты при выдаче — ${tenge(o.balance)}.` : "Заказ оплачен полностью."}`
          : o.invoice > 0
            ? `Счёт Kaspi на ${tenge(o.invoice)} (предоплата ${o.pct} %) выставлен на номер ${o.phone}, ожидается оплата. Бронь до ${hold}.`
            : o.holdUntil
              ? `Бронь до ${hold}. Чтобы её закрепить, внесите предоплату ${o.pct} % — ${tenge(o.prepaymentDue)}: наличными или по счёту Kaspi на номер ${o.phone}. Без предоплаты бронь снимется сама.`
              : `Проверю наличие и подтвержу бронь, счёт Kaspi выставлю на номер ${o.phone}.`,
        pickup
          ? o.pickupMethod === "delivery"
            ? `Доставка ${pickup}: ${DELIVERY_NOTE}.`
            : `Выдача ${pickup}, самовывоз, ${PLACE}.`
          : `Дату выдачи согласуем, самовывоз с теплицы, ${PLACE}.`,
      ]
        .filter(Boolean)
        .join("\n");
    }
    case "payment_reminder":
      return `Напоминаю по заказу ${o.number}: бронь держится до ${o.holdUntil ? dmyhm(o.holdUntil) : "—"}. Предоплата ${tenge(o.prepaymentDue)} по счёту Kaspi. После срока цветы вернутся в продажу.`;
    case "pickup_reminder":
      return `Завтра ${pickup ?? ""} выдача заказа ${o.number}: ${short(o.lines)}. ${toPay(o.balance)}${o.balance > 0 ? " (нал или Kaspi)" : ""}. Теплица открыта ${o.pickupHours}.`;
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
