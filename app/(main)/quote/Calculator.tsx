"use client";

import Link from "next/link";
import { useState } from "react";
import { Composer } from "@/components/Composer";
import { LinesEditor } from "@/components/LinesEditor";
import type { Rule } from "@/lib/calc";
import { dm, tenge } from "@/lib/format";
import { computeQuote, type LineState, type ProductOpt } from "@/lib/quote";
import { hoursFor, pctOptions, type SeasonSettings } from "@/lib/settings";
import { quoteText } from "@/lib/templates";

export function Calculator(p: { products: ProductOpt[]; rules: Rule[]; settings: SeasonSettings; today: string; pickupFrom: string; pickupTo: string }) {
  const [lines, setLines] = useState<LineState[]>([{ key: "classic", packs: 4 }]);
  const [pct, setPct] = useState(p.settings.prepayment_min_pct);
  const [date, setDate] = useState("");
  const q = computeQuote({ ...p, lines, pct, date: date || null });

  const warnings = [
    ...q.problems,
    ...q.priced.missing.map((t) => `Нет цены на сегодня для ${t === "classic" ? "классики" : "махровых"} — проверьте сетку`),
    ...q.shortages,
    ...(q.overThreshold ? [`От ${tenge(p.settings.check_threshold_amount)} заказ потребует проверки`] : []),
  ];
  const text = quoteText({
    day: p.today,
    lines: q.priced.lines,
    total: q.total,
    pct,
    prepayment: q.prepayment,
    validUntil: q.priced.validUntil,
    pickupHours: hoursFor(p.settings, date || null),
    minStems: p.settings.min_order_stems,
  });
  const bookHref = `/orders/new?${new URLSearchParams({ lines: q.rows.map((r) => `${r.productId}:${r.qtyPacks}`).join(","), pct: String(pct), date })}`;

  return (
    <div className="space-y-4">
      <LinesEditor lines={lines} onChange={setLines} products={p.products} allowAny prices={q.prices} />

      <div>
        <span className="label">Предоплата</span>
        <div className="flex gap-1" role="group" aria-label="Предоплата">
          {pctOptions(p.settings).map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setPct(v)}
              aria-pressed={v === pct}
              className={`btn min-h-10 min-w-0 flex-1 px-0 text-xs ${v === pct ? "btn-primary" : ""}`}
            >
              {v}%
            </button>
          ))}
        </div>
      </div>

      <label className="block">
        <span className="label">Дата выдачи (необязательно)</span>
        <input type="date" value={date} min={p.pickupFrom} max={p.pickupTo} onChange={(e) => setDate(e.target.value)} className="input" />
      </label>

      <div className="card space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Итого</span>
          <span className="text-3xl font-extrabold tabular-nums">{tenge(q.total)}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Предоплата {pct}%</span>
          <b className="tabular-nums">{tenge(q.prepayment)}</b>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-muted">Остаток при выдаче</span>
          <span className="tabular-nums">{tenge(q.total - q.prepayment)}</span>
        </div>
        {q.priced.validUntil && <p className="pt-1 text-sm text-muted">Цена действует до {dm(q.priced.validUntil)}</p>}
      </div>

      {warnings.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {warnings.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}

      {q.allColored ? (
        <Link href={bookHref} className="btn btn-primary w-full">
          Оформить бронь
        </Link>
      ) : (
        <p className="text-center text-sm text-muted">Чтобы оформить бронь, выберите цвет в каждой строке</p>
      )}

      <section className="card space-y-2">
        <h2>Ответ клиенту</h2>
        <Composer key={text} templates={[{ key: "quote", label: "Расчёт", text }]} orderLink />
      </section>
    </div>
  );
}
