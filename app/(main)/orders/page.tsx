import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { invoiceAction, issueAction, paymentAction, statusAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { balanceOf, BOARD, dueOf, groupBoard, left, waiting } from "@/lib/board";
import { prettyPhone, tenge } from "@/lib/format";
import { STATUS_LABEL } from "@/lib/status";
import { currentSeason } from "@/services/catalog";
import { orderList, pendingInvoices, type OrderListRow } from "@/services/orders";

export const metadata: Metadata = { title: "Заказы" };

const who = (r: { company: string | null; name: string; phone?: string }) => r.company || r.name || (r.phone ? prettyPhone(r.phone) : "—");
const small = "min-h-9 w-full text-xs";

// The one next step of a card, a tap away from the board; anything else is on the order card
function NextStep({ r, invoice }: { r: OrderListRow; invoice?: { id: string; amount: number } }) {
  const bal = balanceOf(r);
  if (r.status === "new" || r.status === "expired")
    return (
      <ActionForm action={statusAction} className="">
        <input type="hidden" name="id" value={r.id} />
        <input type="hidden" name="op" value={r.status === "new" ? "confirm" : "resume"} />
        <Submit className={`btn-primary ${small}`}>{r.status === "new" ? "Подтвердить" : "Возобновить"}</Submit>
      </ActionForm>
    );
  if (r.status === "confirmed")
    // an invoice already sent is the payment to close — a second record would pay twice
    return invoice ? (
      <ActionForm action={invoiceAction} className="">
        <input type="hidden" name="paymentId" value={invoice.id} />
        <Submit className={`btn-primary ${small}`} confirm={`${r.number}: счёт Kaspi ${tenge(invoice.amount)} оплачен?`}>
          Счёт оплачен
        </Submit>
      </ActionForm>
    ) : (
      <ActionForm action={paymentAction} className="">
        <input type="hidden" name="id" value={r.id} />
        <input type="hidden" name="amount" value={dueOf(r)} />
        <input type="hidden" name="method" value="kaspi_invoice" />
        <Submit className={`btn-primary ${small}`} confirm={`${r.number}: предоплата ${tenge(dueOf(r))} по Kaspi получена?`}>
          Оплачено {tenge(dueOf(r))}
        </Submit>
      </ActionForm>
    );
  if (r.status === "prepaid" || r.status === "ready")
    return bal > 0 ? (
      <Link href={`/orders/${r.id}`} className={`btn btn-primary ${small}`}>
        Выдать · доплата {tenge(bal)}
      </Link>
    ) : (
      <ActionForm action={issueAction} className="">
        <input type="hidden" name="id" value={r.id} />
        <Submit className={`btn-primary ${small}`} confirm={`Выдать ${r.number} целиком?`}>
          Выдано
        </Submit>
      </ActionForm>
    );
  return null;
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
  const q = sp.q ?? "";
  const closed = sp.closed === "1";
  const href = (p: Record<string, string>) => `/orders?${new URLSearchParams({ season: season.id, q, closed: closed ? "1" : "", ...p })}`;
  const ready = season.settings.ready_status_enabled;
  const [rows, invoices] = await Promise.all([orderList({ seasonId: season.id, statuses: closed ? [] : BOARD, q }), pendingInvoices(season.id)]);
  const invoiceOf = new Map(invoices.map((i) => [i.orderId, i]));
  const cols = groupBoard(rows, closed).filter((c) => c.status !== "ready" || ready || c.rows.length);

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h1>Заказы</h1>
        <Link href="/orders/new" className="btn btn-primary">
          + Заказ
        </Link>
      </div>

      {all.length > 1 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {all.map((s) => (
            <Link key={s.id} href={href({ season: s.id })} className={s.id === season.id ? "font-semibold text-accent" : "text-muted"}>
              {s.name}
            </Link>
          ))}
        </div>
      )}

      <form className="flex gap-2">
        <input type="hidden" name="season" value={season.id} />
        {closed && <input type="hidden" name="closed" value="1" />}
        <input name="q" defaultValue={q} type="search" placeholder="Телефон, имя, магазин, номер" aria-label="Поиск по заказам" className="input" />
        {q && (
          <Link href={href({ q: "" })} className="btn shrink-0">
            Сброс
          </Link>
        )}
      </form>

      {/* Spec §5.4: columns side by side from lg; on the phone one row per status with a swipeable strip of cards */}
      <div data-wide className="space-y-3 lg:flex lg:items-start lg:gap-3 lg:space-y-0 lg:overflow-x-auto lg:pb-2 no-scrollbar">
        {cols.map((c) => (
          <section key={c.status} aria-label={STATUS_LABEL[c.status]} className="flex gap-2 lg:min-w-60 lg:flex-1 lg:flex-col lg:rounded-2xl lg:bg-line/40 lg:p-2">
            <header className="w-24 shrink-0 pt-1 lg:w-auto lg:px-1">
              <h2 className="text-sm leading-tight">{STATUS_LABEL[c.status]}</h2>
              <p className="mt-0.5 text-xs text-muted tabular-nums">
                {c.rows.length} · {c.rows.reduce((a, r) => a + r.packs, 0)} пач.
              </p>
            </header>
            <ul className="no-scrollbar flex min-w-0 flex-1 snap-x gap-2 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
              {c.rows.map((r) => (
                <li key={r.id} className="w-56 shrink-0 snap-start lg:w-auto">
                  <div className="card flex h-full flex-col gap-2 p-3 text-sm">
                    <Link href={`/orders/${r.id}`} className="block flex-1">
                      <div className="flex justify-between gap-2 text-muted tabular-nums">
                        <span>{r.number}</span>
                        <span>{r.packs} пач.</span>
                      </div>
                      <p className="truncate font-semibold">{who(r)}</p>
                      <p className="font-semibold tabular-nums">{tenge(r.total)}</p>
                      {waiting(r) && <p className="text-muted">{waiting(r)}</p>}
                      {r.status === "confirmed" && r.holdUntil && <p className="font-semibold text-up">бронь: {left(r.holdUntil)}</p>}
                    </Link>
                    <NextStep r={r} invoice={invoiceOf.get(r.id)} />
                  </div>
                </li>
              ))}
              {!c.rows.length && <li className="py-1 text-sm text-muted">—</li>}
            </ul>
          </section>
        ))}
      </div>

      <Link href={href({ closed: closed ? "" : "1" })} className="inline-flex rounded-full border border-line bg-white px-3 py-1.5 text-sm">
        {closed ? "Скрыть истёкшие и отменённые" : "Показать истёкшие и отменённые"}
      </Link>
    </div>
  );
}
