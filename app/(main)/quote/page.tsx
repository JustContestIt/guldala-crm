import type { Metadata } from "next";
import Link from "next/link";
import { almatyDay } from "@/lib/format";
import { currentSeason, productOpts, seasonRules } from "@/services/catalog";
import { expireHolds } from "@/services/orders";
import { Calculator } from "./Calculator";

export const metadata: Metadata = { title: "Расчёт" };

export default async function QuotePage() {
  const season = await currentSeason();
  if (!season)
    return (
      <p className="card">
        Сезона нет — <Link href="/settings" className="text-accent underline">создайте его в настройках</Link>.
      </p>
    );
  await expireHolds();
  const [rules, products] = await Promise.all([seasonRules(season.id), productOpts(season.id)]);
  return (
    <div className="space-y-4">
      <h1>Расчёт</h1>
      <Calculator products={products} rules={rules} settings={season.settings} today={almatyDay(new Date())} pickupFrom={season.pickupFrom} pickupTo={season.pickupTo} />
    </div>
  );
}
