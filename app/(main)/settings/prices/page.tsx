import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink } from "@/components/ui";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { cellName, toMatrix, TYPES } from "@/lib/grid";
import { currentSeason, seasonRules } from "@/services/catalog";
import { saveGridAction } from "../actions";

export const metadata: Metadata = { title: "Сетка цен" };

// «Настройки → Сетка цен» (review 09.11.2026, К13: inside the season page nobody found it); ?season= for another season
export default async function PricesPage({ searchParams }: { searchParams: Promise<{ season?: string }> }) {
  await requireOwner();
  const sp = await searchParams;
  const all = await db.select().from(seasons).orderBy(desc(seasons.peakDate));
  const season = all.find((s) => s.id === sp.season) ?? (await currentSeason());
  if (!season)
    return (
      <p className="card">
        Сезона нет — <Link href="/settings" className="text-accent underline">создайте его</Link>.
      </p>
    );
  const grid = toMatrix(await seasonRules(season.id));
  const bands = [...grid.bands, null]; // + a blank one for a new band
  const periods = [...grid.periods, null];

  return (
    <div className="space-y-4">
      <BackLink href="/more">Настройки</BackLink>
      <h1>Сетка цен · {season.name}</h1>
      {all.length > 1 && (
        <div className="flex flex-wrap gap-3 text-sm">
          {all.map((s) => (
            <Link key={s.id} href={`/settings/prices?season=${s.id}`} className={s.id === season.id ? "font-semibold text-accent" : "text-muted"}>
              {s.name}
            </Link>
          ))}
        </div>
      )}
      <section className="card space-y-3">
        <h2>Цена за штуку, ₸</h2>
        <p className="text-sm text-muted">
          Период заказа × полоса предоплаты × тип. Пустая клетка — цены нет. Пустые полоса и период внизу — для новых.
        </p>
        <ActionForm action={saveGridAction} className="space-y-3">
          <input type="hidden" name="seasonId" value={season.id} />
          <fieldset className="space-y-2">
            <legend className="label">Полосы предоплаты, %</legend>
            {bands.map((b, i) => (
              <div key={i} className="flex items-center gap-2">
                <input name="bmin" inputMode="numeric" aria-label="Предоплата от, %" placeholder="от" defaultValue={b?.min} className="input w-20" />
                <span>–</span>
                <input name="bmax" inputMode="numeric" aria-label="Предоплата до, %" placeholder="до" defaultValue={b?.max} className="input w-20" />
                {b ? (
                  <label className="flex items-center gap-1 text-sm text-muted">
                    <input type="checkbox" name="delb" value={i} className="size-5" />
                    удалить
                  </label>
                ) : (
                  <span className="text-sm text-muted">новая</span>
                )}
              </div>
            ))}
          </fieldset>
          {periods.map((p, j) => (
            <fieldset key={j} className="space-y-2 rounded-xl border border-line p-3">
              <legend className="px-1 text-sm font-semibold">{p ? `Период ${j + 1}` : "Новый период"}</legend>
              <div className="grid grid-cols-2 gap-2">
                <input name="pfrom" type="date" aria-label="Период с" defaultValue={p?.from} className="input" />
                <input name="pto" type="date" aria-label="Период по" defaultValue={p?.to} className="input" />
              </div>
              <table className="w-full text-sm">
                <thead className="text-left text-muted">
                  <tr>
                    <th className="pr-2 font-normal">Предоплата</th>
                    <th className="font-normal">Классика</th>
                    <th className="font-normal">Махровые</th>
                  </tr>
                </thead>
                <tbody>
                  {bands.map((b, i) => (
                    <tr key={i}>
                      <td className="pr-2 text-muted">{b ? `${b.min}–${b.max}` : "новая"}</td>
                      {TYPES.map((t) => (
                        <td key={t} className="py-1 pr-2">
                          <input
                            name={cellName(t, j, i)}
                            inputMode="numeric"
                            aria-label={`${t === "classic" ? "Классика" : "Махровые"}, ${b ? `${b.min}–${b.max} %` : "новая полоса"}`}
                            defaultValue={p && b ? grid.cells.get(cellName(t, j, i)) : undefined}
                            className="input min-h-10 py-1 font-semibold"
                          />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {p && (
                <label className="flex items-center gap-2 text-sm text-muted">
                  <input type="checkbox" name="delp" value={j} className="size-5" />
                  удалить период
                </label>
              )}
            </fieldset>
          ))}
          <Submit>Сохранить сетку</Submit>
        </ActionForm>
      </section>
    </div>
  );
}
