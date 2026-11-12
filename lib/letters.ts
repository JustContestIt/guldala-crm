// The order confirmation by e-mail (review 09.11.2026, К23): goes when a request comes in («Новый», review 12.11.2026, П2)
// and when the order becomes «Бронь» or «Предоплачен», and again on «Отправить ещё раз». A confirmation, not a receipt; the order page on the site has the rest.
import type { Status } from "./calc";
import { dmy, dmyhm, hhmm, tenge } from "./format";
import { DELIVERY_NOTE, PLACE, type OrderView } from "./templates";

export type LetterOrder = OrderView & {
  name: string;
  status: Status;
  options: { pct: number; total: number; prepayment: number }[]; // the order at every prepayment, by priceDay
  url: string; // the client's order page on the site
};

// Statuses a letter is written for; any other one gets no letter
export const LETTER_STATUSES: Status[] = ["new", "confirmed", "prepaid", "ready"];

export function confirmationLetter(o: LetterOrder): { subject: string; text: string } {
  const request = o.status === "new";
  const booked = o.status === "confirmed";
  const hold = o.holdUntil ? dmyhm(o.holdUntil) : "";
  const subject = request
    ? `Заказ ${o.number}: заявка получена`
    : booked
      ? `Заказ ${o.number}: ${o.invoice ? "бронь, ожидаем оплату" : `бронь до ${hold}`}`
      : `Заказ ${o.number} оформлен, предоплата получена`;
  const state = request
    ? [`Проверим наличие и подтвердим бронь в WhatsApp на номер ${o.phone}, цены зафиксируем в день подтверждения.`]
    : booked
    ? o.invoice
      ? [
          `Цветы отложены за вами до ${hold}.`,
          `Ожидаем оплату счёта Kaspi на ${tenge(o.invoice)}: он придёт в приложение Kaspi на номер ${o.phone}. Как только оплата поступит, заказ будет оформлен.`,
        ]
      : [
          `Цветы отложены за вами до ${hold}. Цены по сетке на ${dmy(o.priceDay)} держим до этого срока:`,
          ...o.options.map((x) => `— предоплата ${x.pct} %: внести ${tenge(x.prepayment)}, заказ ${tenge(x.total)}`),
          `Выберите процент и ответьте на это письмо или напишите нам в WhatsApp: выставим счёт Kaspi на номер ${o.phone}. Без предоплаты бронь снимется ${hold}, цветы вернутся в продажу.`,
        ]
    : [
        `Принята предоплата ${tenge(o.paid)}. Заказ оформлен, цветы закреплены за вами.`,
        o.balance > 0 ? `Остаток оплаты при получении: ${tenge(o.balance)} (наличными или Kaspi).` : "Заказ оплачен полностью.",
      ];
  const pickup = o.pickupDate
    ? o.pickupMethod === "delivery"
      ? `Доставка ${dmy(o.pickupDate)}${o.pickupTime ? ` ${hhmm(o.pickupTime)}` : ""}: ${DELIVERY_NOTE}.`
      : `Выдача ${dmy(o.pickupDate)}${o.pickupTime ? ` ${hhmm(o.pickupTime)}` : ""}, самовывоз, ${PLACE}.`
    : `Дату выдачи согласуем, самовывоз с теплицы, ${PLACE}.`;
  const text = [
    o.name ? `Здравствуйте, ${o.name}!` : "Здравствуйте!",
    "",
    request ? `Мы получили вашу заявку на заказ ${o.number} в Guldala Tulpan.` : `Подтверждение заказа ${o.number} от Guldala Tulpan.`,
    ...state,
    "",
    "Состав:",
    ...o.lines.map((l) => `— ${l.name}: ${l.qtyPacks} пач. × ${l.packSize} шт × ${tenge(l.unitPrice)} = ${tenge(l.lineTotal)}`),
    o.discount > 0 && `Скидка: ${tenge(o.discount)}`,
    o.storageFee > 0 && `Холодильник до вывоза: ${tenge(o.storageFee)}`,
    `Итого: ${tenge(o.total)}${booked && !o.invoice ? ` при предоплате ${o.pct} %` : ""}`,
    o.prepayOff > 0 && `Цены со скидкой ${o.prepayOff} % за 100 % предоплату.`,
    "",
    pickup,
    "",
    `Страница заказа, где видно статус и историю: ${o.url}`,
    "",
    "Guldala Tulpan",
  ]
    .filter((x) => x !== false)
    .join("\n");
  return { subject, text };
}
