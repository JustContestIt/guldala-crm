// order_events → one line of the order journal
import type { Status } from "./calc";
import { dm, dmhm, tenge } from "./format";
import { STATUS_LABEL } from "./status";
import { ORDER_TEMPLATES } from "./templates";

type Ev = { type: string; fromStatus: string | null; toStatus: string | null; payload: Record<string, unknown> };
const st = (s: string | null) => (s ? STATUS_LABEL[s as Status] ?? s : "");
const METHOD: Record<string, string> = { kaspi_invoice: "Kaspi", cash: "наличные", bank_transfer: "перевод" };
const TEMPLATE: Record<string, string> = { ...ORDER_TEMPLATES, quote: "Расчёт" };

export function describeEvent(e: Ev): string {
  const p = e.payload as Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  switch (e.type) {
    case "status_change":
      if (p.created) return `Создан: «${st(e.toStatus)}»${p.shortages ? ` — не хватает: ${p.shortages.join("; ")}` : p.threshold ? ` — от ${tenge(p.threshold)} нужна проверка` : ""}`;
      return `${st(e.fromStatus)} → ${st(e.toStatus)}${p.reason ? `: ${p.reason}` : ""}`;
    case "payment": {
      const what = { paid: "Оплата", pending: "Выставлен счёт", cancelled: "Отменён счёт" }[p.status as string] ?? "Платёж";
      return `${what} ${tenge(p.amount)}${p.method ? `, ${METHOD[p.method] ?? p.method}` : ""}${p.invoiceRef ? `, ${p.invoiceRef}` : ""}`;
    }
    case "edit":
      if (p.repriced) return `Цена пересчитана по сетке на ${dm(p.repriced)}: ${tenge(p.totalFrom)} → ${tenge(p.totalTo)}`;
      if (p.discount) return `Скидка ${tenge(p.discount.to)}${p.reason ? `: ${p.reason}` : ""}`;
      if (p.items) return `Состав: ${p.items.from} → ${p.items.to}; сумма ${tenge(p.totalFrom)} → ${tenge(p.totalTo)}`;
      if (p.substitution)
        return p.substitution.to
          ? `Замена: ${p.substitution.item} → ${p.substitution.to}${p.substitution.note ? ` (${p.substitution.note})` : ""}`
          : `Замена снята: ${p.substitution.item}`;
      if (p.holdUntil) return `Бронь продлена до ${dmhm(new Date(p.holdUntil.to))}`;
      return "Изменён";
    case "message_sent":
      return `Отправлено в WhatsApp: ${TEMPLATE[p.template] ?? p.template}${p.provider === "fake" ? " (тестовый режим)" : ""}`;
    case "notification":
      return p.error ? `Не отправилось (${TEMPLATE[p.template] ?? p.template}): ${p.error}` : "Уведомление";
    default:
      return e.type;
  }
}
