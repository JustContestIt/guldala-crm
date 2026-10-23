import type { Metadata } from "next";
import Link from "next/link";
import { issueAction, noShowAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { balanceOf } from "@/lib/board";
import type { Status } from "@/lib/calc";
import { addDays, almatyDay, dm, hhmm, prettyPhone, tenge } from "@/lib/format";
import { currentSeason } from "@/services/catalog";
import { issueList } from "@/services/orders";

export const metadata: Metadata = { title: "Выдача" };

// Spec §5.5: the gate on peak days, read outdoors — big type, few controls
export default async function IssuePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const season = await currentSeason();
  if (!season)
    return (
      <p className="card">
        Сезона нет — <Link href="/settings" className="text-accent underline">создайте его в настройках</Link>.
      </p>
    );
  const today = almatyDay(new Date());
  const day = /^\d{4}-\d{2}-\d{2}$/.test(sp.date ?? "") ? sp.date! : today;
  const q = sp.q ?? "";
  const statuses: Status[] = ["prepaid", "ready", ...(season.settings.issue_on_full_payment_allowed ? (["confirmed"] as const) : [])];
  const rows = await issueList(season.id, day, statuses, q);
  const days: string[] = [];
  for (let d = season.pickupFrom; d <= season.pickupTo; d = addDays(d, 1)) days.push(d);
  if (!days.includes(today)) days.unshift(today);

  return (
    <div className="space-y-4">
      <h1>Выдача {dm(day)}</h1>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {days.map((d) => (
          <Link
            key={d}
            href={`/issue?date=${d}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 font-semibold tabular-nums ${d === day ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
          >
            {d === today ? "сегодня" : dm(d)}
          </Link>
        ))}
      </div>
      <form className="flex gap-2">
        <input type="hidden" name="date" value={day} />
        <input name="q" defaultValue={q} type="search" inputMode="search" placeholder="Номер заказа или 4 цифры телефона" aria-label="Поиск" className="input" />
        <button className="btn">Найти</button>
      </form>

      <ul className="space-y-3">
        {rows.map((r) => {
          const bal = balanceOf(r);
          const left = r.items.filter((i) => i.issuedStems < i.qtyStems);
          return (
            <li key={r.id} className="card space-y-3">
              <Link href={`/orders/${r.id}`} className="block">
                <div className="flex items-baseline justify-between gap-2 text-xl font-extrabold tabular-nums">
                  <span>{r.number}</span>
                  <span>{hhmm(r.pickupTime)}</span>
                </div>
                <p className="font-semibold">
                  {r.company || r.name || "Без имени"} · {prettyPhone(r.phone)}
                </p>
              </Link>
              <ul className="text-lg font-semibold">
                {r.items.map((i) => (
                  <li key={i.id}>
                    {i.substituteName ?? i.name} × {i.qtyPacks} пач.
                    {i.issuedStems > 0 && <span className="text-base font-normal text-muted"> · выдано {i.issuedStems / i.packSize}</span>}
                  </li>
                ))}
              </ul>
              <p className={`text-lg font-bold ${bal > 0 ? "text-up" : "text-accent"}`}>{bal > 0 ? `К доплате ${tenge(bal)}` : "Оплачен полностью"}</p>
              {(r.storageRequested || r.pickupMethod === "client_truck") && (
                <p className="flex gap-2 text-sm font-semibold">
                  {r.storageRequested && <span className="rounded-full bg-mint px-2.5 py-0.5 text-accent-dark">холодильник</span>}
                  {r.pickupMethod === "client_truck" && <span className="rounded-full bg-warn-bg px-2.5 py-0.5 text-warn">машина клиента</span>}
                </p>
              )}
              <div className="flex flex-wrap items-start gap-2">
                <ActionForm action={issueAction} className="flex flex-wrap items-center gap-2">
                  <input type="hidden" name="id" value={r.id} />
                  {bal > 0 && (
                    <select name="method" aria-label="Остаток принят" className="input w-auto">
                      <option value="cash">Наличные</option>
                      <option value="kaspi_invoice">Kaspi</option>
                    </select>
                  )}
                  <Submit confirm={`Выдать ${r.number} целиком${bal > 0 ? ` и принять ${tenge(bal)}` : ""}?`}>Выдано</Submit>
                </ActionForm>
                <ActionForm action={noShowAction}>
                  <input type="hidden" name="id" value={r.id} />
                  <input type="hidden" name="day" value={day} />
                  <Submit className="" confirm={`${r.number}: не приехал?`}>
                    Не приехал
                  </Submit>
                </ActionForm>
              </div>
              {r.status !== "confirmed" && (
                <details>
                  <summary className="btn">Частично</summary>
                  <ActionForm action={issueAction} className="mt-2 space-y-2">
                    <input type="hidden" name="id" value={r.id} />
                    <input type="hidden" name="partial" value="1" />
                    {left.map((i) => (
                      <Field key={i.id} label={`${i.substituteName ?? i.name}: выдать сейчас, пач. (осталось ${(i.qtyStems - i.issuedStems) / i.packSize})`}>
                        <input name={`packs:${i.id}`} inputMode="numeric" defaultValue="0" className="input" />
                      </Field>
                    ))}
                    <Submit>Записать выдачу</Submit>
                  </ActionForm>
                </details>
              )}
            </li>
          );
        })}
        {!rows.length && <li className="card text-center text-muted">На {dm(day)} выдач нет</li>}
      </ul>
    </div>
  );
}
