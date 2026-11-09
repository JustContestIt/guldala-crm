// Order status machine of spec §7. Services check every transition here before writing it.
import type { Status } from "./calc";

const NEXT: Record<Status, Status[]> = {
  new: ["confirmed", "cancelled"],
  confirmed: ["prepaid", "expired", "cancelled"],
  prepaid: ["ready", "issued", "cancelled"],
  ready: ["issued", "cancelled"],
  issued: [],
  expired: ["confirmed"],
  cancelled: [],
};

export const canMove = (from: Status, to: Status) => NEXT[from].includes(to);

export const STATUS_LABEL: Record<Status, string> = {
  new: "Новый",
  confirmed: "Бронь",
  prepaid: "Предоплачен",
  ready: "На выдачу",
  issued: "Выдан",
  expired: "Бронь истекла",
  cancelled: "Отменён",
};

// Under each board column: why a card is here and what to do with it (Nikita 09.11.2026: «не понятно, что куда класть и почему»)
export const STATUS_HINT: Record<Status, string> = {
  new: "Заявка с сайта, от бота или ваша. Товар ещё не отложен: проверьте состав и подтвердите.",
  confirmed: "Товар отложен. Выставьте счёт Kaspi на предоплату; деньги пришли — «Оплачено». Не оплатят в срок — бронь снимется сама.",
  prepaid: "Предоплата получена. Соберите заказ к дню выдачи; остаток клиент платит при выдаче.",
  ready: "Заказ собран и ждёт клиента. Забрал — «Выдать», остаток берём при выдаче.",
  issued: "Клиент забрал заказ.",
  expired: "Предоплата не пришла в срок, товар вернулся в продажу. Можно возобновить по сегодняшней цене.",
  cancelled: "Отменён, товар вернулся в продажу.",
};

// What a card dropped on this column does (shown on the lit columns during a drag)
export const DROP_LABEL: Partial<Record<Status, string>> = {
  confirmed: "Отпустите — подтвердить бронь",
  prepaid: "Отпустите — предоплата получена",
  ready: "Отпустите — заказ собран",
  issued: "Отпустите — выдать клиенту",
};

export const ACTIVE: Status[] = ["new", "confirmed", "prepaid", "ready"];

// Statuses in which money can still be recorded against the order
export const PAYABLE: Status[] = ["confirmed", "prepaid", "ready", "issued"];
