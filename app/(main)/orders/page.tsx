import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { invoiceAction, paymentAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { StatusBadge } from "@/components/ui";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { prepaymentAmount, type Status } from "@/lib/calc";
import { dm, dmhm, hhmm, prettyPhone, tenge } from "@/lib/format";
import { ACTIVE, STATUS_LABEL } from "@/lib/status";
import { currentSeason } from "@/services/catalog";
import { orderList, pendingInvoices, type OrderListRow } from "@/services/orders";

export const metadata: Metadata = { title: "Заказы" };

const FILTERS: [string, string][] = [["active", "Активные"], ...(Object.entries(STATUS_LABEL) as [string, string][]), ["all", "Все"]];

const who = (r: { company: string | null; name: string; phone?: string }) => r.company || r.name || (r.phone ? prettyPhone(r.phone) : "—");
const balanceOf = (r: OrderListRow) => Math.max(0, r.total - r.paid);
const dueOf = (r: OrderListRow) => Math.max(0, prepaymentAmount(r.total, r.prepaymentPct) - r.paid);
const days = (d: Date) => Math.floor((Date.now() - d.getTime()) / 86_400_000);
const pickupOf = (r: OrderListRow) => (r.pickupDate ? `${dm(r.pickupDate)}${r.pickupTime ? ` ${hhmm(r.pickupTime)}` : ""}` : null);

// «Что ждём» column of spec §5.4
function waiting(r: OrderListRow) {
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

function PayForm({ orderId, amount, label = "Оплачено" }: { orderId: string; amount: number; label?: string }) {
  return (
    <details className="w-full">
      <summary className="btn btn-primary min-h-9 text-xs">{label}</summary>
      <ActionForm action={paymentAction} className="mt-2 flex flex-wrap items-end gap-2">
        <input type="hidden" name="id" value={orderId} />
        <input name="amount" inputMode="numeric" defaultValue={amount} aria-label="Сумма, ₸" className="input w-32" />
        <select name="method" aria-label="Способ" className="input w-auto">
          <option value="kaspi_invoice">Kaspi</option>
          <option value="cash">Наличные</option>
        </select>
        <Submit>Записать</Submit>
      </ActionForm>
    </details>
  );
}

function Row({ r, children }: { r: OrderListRow; children?: React.ReactNode }) {
  return (
    <li className="px-4 py-3">
      <Link href={`/orders/${r.id}`} className="block">
        <div className="flex items-center justify-between gap-2">
          <span className="font-semibold">{who(r)}</span>
          <span className="font-semibold tabular-nums">{tenge(r.total)}</span>
        </div>
        <div className="mt-0.5 flex items-center justify-between gap-2 text-sm text-muted">
          <span>
            {r.number} · {r.packs} пач.
          </span>
          <StatusBadge status={r.status} />
        </div>
        {waiting(r) && <p className="mt-1 text-sm">{waiting(r)}</p>}
      </Link>
      {children && <div className="mt-2 flex flex-wrap gap-2">{children}</div>}
    </li>
  );
}

export default async function OrdersPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const all = await db.select().from(seasons).orderBy(desc(seasons.peakDate));
  const season = all.find((s) => s.id === sp.season) ?? (await currentSeason());
  if (!season)
    return (
      <p className="card">
        Сезона нет — <Link href="/settings" className="text-accent underline">создайте его в настройках</Link>.
      </p>
    );
  const tab = sp.tab === "money" ? "money" : "list";
  const filter = FILTERS.some(([k]) => k === sp.status) ? sp.status! : "active";
  const statuses: Status[] = filter === "active" ? ACTIVE : filter === "all" ? [] : [filter as Status];
  const q = sp.q ?? "";
  const href = (p: Record<string, string>) => `/orders?${new URLSearchParams({ season: season.id, tab, status: filter, q, ...p })}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1>Заказы</h1>
        <Link href="/orders/new" className="btn btn-primary">
          + Заказ
        </Link>
      </div>

      {all.length > 1 && (
        <div className="flex flex-wrap gap-2 text-sm">
          {all.map((s) => (
            <Link key={s.id} href={href({ season: s.id })} className={s.id === season.id ? "font-semibold text-accent" : "text-muted"}>
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <div className="flex rounded-xl border border-line bg-white p-1 text-sm font-semibold">
        {(
          [
            ["list", "Список"],
            ["money", "Деньги"],
          ] as const
        ).map(([k, label]) => (
          <Link key={k} href={href({ tab: k })} className={`flex-1 rounded-lg py-2 text-center ${tab === k ? "bg-mint text-accent-dark" : "text-muted"}`}>
            {label}
          </Link>
        ))}
      </div>

      {tab === "list" ? <List seasonId={season.id} statuses={statuses} q={q} filter={filter} href={href} /> : <Money seasonId={season.id} />}
    </div>
  );
}

async function List({ seasonId, statuses, q, filter, href }: { seasonId: string; statuses: Status[]; q: string; filter: string; href: (p: Record<string, string>) => string }) {
  const rows = await orderList({ seasonId, statuses, q });
  return (
    <>
      <form className="flex gap-2">
        <input type="hidden" name="season" value={seasonId} />
        <input type="hidden" name="status" value={filter} />
        <input name="q" defaultValue={q} type="search" placeholder="Телефон, имя, магазин, номер" aria-label="Поиск" className="input" />
        <button className="btn">Найти</button>
      </form>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {FILTERS.map(([k, label]) => (
          <Link
            key={k}
            href={href({ status: k })}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${k === filter ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      <ul className="card divide-y divide-line p-0">
        {rows.map((r) => (
          <Row key={r.id} r={r} />
        ))}
        {!rows.length && <li className="px-4 py-6 text-center text-muted">Заказов нет</li>}
      </ul>
    </>
  );
}

async function Money({ seasonId }: { seasonId: string }) {
  const [rows, invoices] = await Promise.all([orderList({ seasonId, statuses: ["confirmed", "prepaid", "ready", "issued"], q: "" }), pendingInvoices(seasonId)]);
  const prepay = rows.filter((r) => r.status === "confirmed");
  const balance = rows.filter((r) => r.status !== "confirmed" && balanceOf(r) > 0);

  return (
    <div className="space-y-4">
      <section className="space-y-2">
        <h2>
          Ждём предоплату · {tenge(prepay.reduce((a, r) => a + dueOf(r), 0))}
        </h2>
        <ul className="card divide-y divide-line p-0">
          {prepay.map((r) => (
            <Row key={r.id} r={r}>
              <Link href={`/orders/${r.id}?msg=payment_reminder`} className="btn min-h-9 text-xs">
                Напомнить
              </Link>
              <PayForm orderId={r.id} amount={dueOf(r)} />
            </Row>
          ))}
          {!prepay.length && <li className="px-4 py-4 text-center text-muted">Никого</li>}
        </ul>
      </section>

      <section className="space-y-2">
        <h2>
          Ждём остаток · {tenge(balance.reduce((a, r) => a + balanceOf(r), 0))}
        </h2>
        <ul className="card divide-y divide-line p-0">
          {balance.map((r) => (
            <Row key={r.id} r={r}>
              <PayForm orderId={r.id} amount={balanceOf(r)} />
            </Row>
          ))}
          {!balance.length && <li className="px-4 py-4 text-center text-muted">Никого</li>}
        </ul>
      </section>

      <section className="space-y-2">
        <h2>Счета выставлены</h2>
        <ul className="card divide-y divide-line p-0">
          {invoices.map((i) => (
            <li key={i.id} className="px-4 py-3">
              <Link href={`/orders/${i.orderId}`} className="block">
                <div className="flex justify-between gap-2">
                  <span className="font-semibold">{who(i)}</span>
                  <span className="font-semibold tabular-nums">{tenge(i.amount)}</span>
                </div>
                <p className={`text-sm ${days(i.createdAt) >= 3 ? "text-up" : "text-muted"}`}>
                  {i.number} · {i.invoiceRef ?? "без номера"} · выставлен {days(i.createdAt) ? `${days(i.createdAt)} дн. назад` : "сегодня"}
                </p>
              </Link>
              <ActionForm action={invoiceAction} className="mt-2 flex gap-2">
                <input type="hidden" name="paymentId" value={i.id} />
                <Link href={`/orders/${i.orderId}?msg=payment_reminder`} className="btn min-h-9 text-xs">
                  Напомнить
                </Link>
                <Submit className="btn-primary min-h-9 text-xs">Оплачено</Submit>
              </ActionForm>
            </li>
          ))}
          {!invoices.length && <li className="px-4 py-4 text-center text-muted">Нет неоплаченных счетов</li>}
        </ul>
      </section>
    </div>
  );
}
