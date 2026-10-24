import type { Metadata } from "next";
import Link from "next/link";
import { CHANNEL_STATE } from "@/integrations/messaging";
import type { Status } from "@/lib/calc";
import { almatyDay, dmhm, hm, prettyPhone } from "@/lib/format";
import { currentSeason, stockTable } from "@/services/catalog";
import { channelInfo, draftClients, wroteNoOrder } from "@/services/messages";
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
  const [pickups, stock, channel, wrote, drafts] = await Promise.all([
    orderList({ seasonId: season.id, statuses, q: "", pickupDate: almatyDay(new Date()) }),
    stockTable(season.id),
    channelInfo(),
    wroteNoOrder(season.id),
    draftClients(),
  ]);
  const label = (c: { company: string | null; name: string; phone: string }) => c.company || c.name || prettyPhone(c.phone);

  return (
    <div className="space-y-4">
      <h1>Сегодня</h1>

      <Link href="/settings/whatsapp" className={`card flex items-baseline justify-between gap-2 ${channel.state && channel.state !== "active" ? "border-up bg-up-bg" : ""}`}>
        <span className="font-semibold">WhatsApp</span>
        <span className={`text-right text-sm ${channel.state === "active" ? "text-accent-dark" : "text-up"}`}>
          {channel.state ? `${CHANNEL_STATE[channel.state] ?? channel.state} · ${dmhm(channel.stateAt!)}` : "статус неизвестен — проверьте в настройках"}
        </span>
      </Link>

      {drafts.length > 0 && (
        <section className="card space-y-2">
          <h2>Черновики бота: {drafts.reduce((a, d) => a + d.drafts, 0)}</h2>
          <ul className="divide-y divide-line text-sm">
            {drafts.map((d) => (
              <li key={d.id}>
                <Link href={`/clients/${d.id}#chat`} className="block py-2 text-accent underline">
                  {label(d)}
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

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

      <section className="card space-y-2">
        <h2>Написали, но заказа нет</h2>
        <p className="text-sm text-muted">За последние сутки, без активного заказа в этом сезоне.</p>
        <ul className="divide-y divide-line text-sm">
          {wrote.map((w) => (
            <li key={w.id}>
              <Link href={`/clients/${w.id}#chat`} className="flex items-baseline justify-between gap-2 py-2">
                <span className="text-accent underline">{label(w)}</span>
                <span className="text-muted">
                  {w.mutedAt ? "бот молчит · " : ""}
                  {hm(w.at!)}
                </span>
              </Link>
            </li>
          ))}
          {!wrote.length && <li className="py-2 text-muted">Никого</li>}
        </ul>
      </section>
    </div>
  );
}
