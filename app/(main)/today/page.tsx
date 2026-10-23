import type { Metadata } from "next";
import Link from "next/link";
import type { Status } from "@/lib/calc";
import { almatyDay } from "@/lib/format";
import { currentSeason, stockTable } from "@/services/catalog";
import { orderList } from "@/services/orders";

export const metadata: Metadata = { title: "Сегодня" };

// Spec §5.1 after the board: order counters live on the board, here only what the board doesn't show
export default async function TodayPage() {
  const season = await currentSeason();
  if (!season)
    return (
      <p className="card">
        Сезона нет — <Link href="/settings" className="text-accent underline">создайте его в настройках</Link>.
      </p>
    );
  const statuses: Status[] = ["prepaid", "ready", ...(season.settings.issue_on_full_payment_allowed ? (["confirmed"] as const) : [])];
  const [pickups, stock] = await Promise.all([orderList({ seasonId: season.id, statuses, q: "", pickupDate: almatyDay(new Date()) }), stockTable(season.id)]);

  return (
    <div className="space-y-4">
      <h1>Сегодня</h1>

      <Link href="/issue" className="card flex items-baseline justify-between gap-2">
        <span className="font-semibold">Выдачи сегодня</span>
        <span className="text-2xl font-extrabold tabular-nums">
          {pickups.length} <span className="text-sm font-semibold text-muted">· {pickups.reduce((a, r) => a + r.packs, 0)} пач.</span>
        </span>
      </Link>

      <section className="card space-y-2">
        <h2>Остатки по цветам</h2>
        <table className="w-full text-sm">
          <tbody className="divide-y divide-line">
            {stock
              .filter((r) => r.product.isActive)
              .map((r) => {
                const low = r.planned !== null && r.available < r.planned * 0.1;
                return (
                  <tr key={r.product.id}>
                    <td className="py-1.5">{r.product.name}</td>
                    <td className={`py-1.5 text-right font-semibold tabular-nums ${low ? "text-up" : ""}`}>{Math.floor(r.available / r.product.packSize)} пач.</td>
                  </tr>
                );
              })}
          </tbody>
        </table>
      </section>

      {/* stage E: channel status and «написали, но заказа нет» (spec §5.1) */}
      <p className="card text-sm text-muted">Статус WhatsApp и «написали, но заказа нет» появятся с входящими сообщениями (этап E).</p>
    </div>
  );
}
