import { asc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { db } from "@/db";
import { clients } from "@/db/schema";
import { isValidPct } from "@/lib/calc";
import { almatyDay } from "@/lib/format";
import { currentSeason, productOpts, seasonRules } from "@/services/catalog";
import { expireHolds } from "@/services/orders";
import { OrderForm } from "./OrderForm";

export const metadata: Metadata = { title: "Новый заказ" };

// Prefill from «Оформить бронь» in the calculator: ?lines=<id>:<packs>,…&pct=40&date=2027-03-06&phone=+7…
export default async function NewOrderPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
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
    db.select({ phone: clients.phone, name: clients.name, company: clients.company }).from(clients).orderBy(asc(clients.name)),
  ]);
  const lines = (sp.lines ?? "")
    .split(",")
    .map((s) => s.split(":"))
    .filter(([id]) => products.some((p) => p.id === id))
    .map(([key, packs]) => ({ key, packs: Math.max(1, Number(packs) || 1) }));
  const pct = Number(sp.pct);

  return (
    <div className="space-y-4">
      <h1>Новый заказ</h1>
      <OrderForm
        products={products}
        rules={rules}
        settings={season.settings}
        today={almatyDay(new Date())}
        pickupFrom={season.pickupFrom}
        pickupTo={season.pickupTo}
        clients={clientList}
        initial={{
          lines: lines.length ? lines : products.length ? [{ key: products[0].id, packs: 4 }] : [],
          pct: isValidPct(pct, season.settings) ? pct : season.settings.prepayment_min_pct,
          date: /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : "",
          phone: sp.phone ?? "",
        }}
      />
    </div>
  );
}
