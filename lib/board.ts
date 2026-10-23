// Orders board of spec §5.4 and the «что ждём» line shared by the board and the list
import { prepaymentAmount, type Status } from "./calc";
import { dm, dmhm, hhmm, tenge } from "./format";

export type WaitRow = { status: Status; total: number; paid: number; prepaymentPct: number; holdUntil: Date | null; pickupDate: string | null; pickupTime: string | null };

export const balanceOf = (r: WaitRow) => Math.max(0, r.total - r.paid);
export const dueOf = (r: WaitRow) => Math.max(0, prepaymentAmount(r.total, r.prepaymentPct) - r.paid);
const pickupOf = (r: WaitRow) => (r.pickupDate ? `${dm(r.pickupDate)}${r.pickupTime ? ` ${hhmm(r.pickupTime)}` : ""}` : null);

export function waiting(r: WaitRow) {
  const pickup = pickupOf(r);
  switch (r.status) {
    case "new":
      return "ждём подтверждения";
    case "confirmed":
      return `предоплата ${tenge(dueOf(r))} до ${r.holdUntil ? dmhm(r.holdUntil) : "—"}`;
    case "prepaid":
    case "ready":
      return [balanceOf(r) > 0 && `остаток ${tenge(balanceOf(r))}`, pickup ? `выдача ${pickup}` : "дата выдачи не задана"].filter(Boolean).join(", ");
    case "issued":
      return balanceOf(r) > 0 ? `остаток ${tenge(balanceOf(r))}` : "выдан";
    case "expired":
      return "возобновить или забыть";
    case "cancelled":
      return "";
  }
}

// "2 дн 5 ч" / "40 мин" until the hold runs out
export function left(until: Date) {
  const min = Math.round((until.getTime() - Date.now()) / 60_000);
  if (min <= 0) return "истекает";
  const d = Math.floor(min / 1440);
  const h = Math.floor((min % 1440) / 60);
  return d ? `${d} дн ${h} ч` : h ? `${h} ч ${min % 60} мин` : `${min} мин`;
}

export const BOARD: Status[] = ["new", "confirmed", "prepaid", "ready", "issued"];

// One column per status, rows keep the order they came in (next deadline first); expired and cancelled only on request
export const groupBoard = <R extends { status: Status }>(rows: R[], showClosed: boolean) =>
  [...BOARD, ...(showClosed ? (["expired", "cancelled"] as const) : [])].map((status) => ({ status, rows: rows.filter((r) => r.status === status) }));
