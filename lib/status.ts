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
  ready: "Готов к выдаче",
  issued: "Выдан",
  expired: "Бронь истекла",
  cancelled: "Отменён",
};

export const ACTIVE: Status[] = ["new", "confirmed", "prepaid", "ready"];

// Statuses in which money can still be recorded against the order
export const PAYABLE: Status[] = ["confirmed", "prepaid", "ready", "issued"];
