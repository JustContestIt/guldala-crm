import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { Composer } from "@/components/Composer";
import { StatusBadge } from "@/components/ui";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { requireUser } from "@/lib/auth";
import { almatyDay, dmhm, tenge } from "@/lib/format";
import { orderText } from "@/lib/templates";
import { currentSeason, productOpts, seasonRules } from "@/services/catalog";
import { expireHolds, orderCard, orderView } from "@/services/orders";
import { Calculator } from "./Calculator";

export const metadata: Metadata = { title: "Заказ вручную" };

// One screen for a manual order (review 09.11.2026, К28): the board's «+ Заказ» and the client card land here too.
// ?phone= fills the client in; ?order= is the order just created, with its confirmation for the client (К30, К31)
export default async function QuotePage({ searchParams }: { searchParams: Promise<{ phone?: string; order?: string }> }) {
  await requireUser();
  const sp = await searchParams;
  if (sp.order) return <Created id={sp.order} />;
  const season = await currentSeason();
  if (!season || season.status !== "open")
    return (
      <p className="card">
        Нет открытого сезона — <Link href="/settings" className="text-accent underline">откройте его в настройках</Link>.
      </p>
    );
  await expireHolds();
  const [rules, products, clientList] = await Promise.all([
    seasonRules(season.id),
    productOpts(season.id),
    // shortcut: every client goes to the browser for autocomplete; fine for hundreds, search on the server past a few thousand
    db.select({ phone: clients.phone, name: clients.name, company: clients.company, email: clients.email }).from(clients).orderBy(asc(clients.name)),
  ]);
  return (
    <div className="space-y-4">
      <h1>Заказ вручную</h1>
      <Calculator
        products={products}
        rules={rules}
        settings={season.settings}
        today={almatyDay(new Date())}
        pickupFrom={season.pickupFrom}
        pickupTo={season.pickupTo}
        clients={clientList}
        phone={sp.phone ?? ""}
      />
    </div>
  );
}

async function Created({ id }: { id: string }) {
  const card = await orderCard(id);
  if (!card) return <p className="card">Заказ не найден.</p>;
  const { order: o, client } = card;
  const view = orderView(card);
  const state =
    o.status === "prepaid"
      ? `Предоплата ${tenge(view.paid)} принята`
      : view.invoice > 0
        ? `Ожидается оплата счёта Kaspi ${tenge(view.invoice)} · бронь до ${o.holdUntil ? dmhm(o.holdUntil) : "—"}`
        : o.holdUntil && o.status === "confirmed"
          ? `Бронь до ${dmhm(o.holdUntil)}`
          : null;
  return (
    <div className="space-y-4">
      <h1>Заказ вручную</h1>
      <section role="status" className="card space-y-2">
        <div className="flex items-center justify-between gap-2">
          <p className="text-lg font-bold">Заказ {o.number} создан</p>
          <StatusBadge status={o.status} />
        </div>
        <p>
          {[client.company, client.name].filter(Boolean).join(" · ")} · <b className="tabular-nums">{tenge(o.total)}</b>
        </p>
        {state && <p className="font-semibold text-accent-dark">{state}</p>}
        <div className="grid grid-cols-2 gap-2 pt-1">
          <Link href={`/orders/${o.id}`} className="btn">
            Открыть заказ
          </Link>
          <Link href="/quote" className="btn btn-primary">
            Новый заказ
          </Link>
        </div>
      </section>
      <section className="card space-y-2">
        <div className="flex items-center justify-between gap-3">
          <h2>Подтверждение клиенту</h2>
          <a href={`/orders/${o.id}/pdf`} target="_blank" className="btn min-h-9 shrink-0 text-xs">
            PDF
          </a>
        </div>
        <Composer templates={[{ key: "booking", label: "Подтверждение", text: orderText("booking", view) }]} phone={client.phone} orderId={o.id} />
      </section>
    </div>
  );
}
