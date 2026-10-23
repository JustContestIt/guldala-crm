"use client";

import type { TulipType } from "@/lib/calc";
import { tenge } from "@/lib/format";
import { ANY, type LineState, type ProductOpt } from "@/lib/quote";

export function LinesEditor({
  lines,
  onChange,
  products,
  allowAny,
  prices,
}: {
  lines: LineState[];
  onChange: (l: LineState[]) => void;
  products: ProductOpt[];
  allowAny: boolean;
  prices: ({ unitPrice: number; lineTotal: number; qtyStems: number } | null)[];
}) {
  const set = (i: number, patch: Partial<LineState>) => onChange(lines.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  const free = (p: ProductOpt) => Math.max(0, Math.floor(p.freeStems / p.packSize));
  const group = (t: TulipType) =>
    products
      .filter((p) => p.tulipType === t)
      .map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · свободно {free(p)} пач.
        </option>
      ));

  return (
    <div className="space-y-2">
      {lines.map((l, i) => {
        const price = prices[i];
        return (
          <div key={i} className="rounded-xl border border-line p-2">
            <div className="flex gap-2">
              <select value={l.key} onChange={(e) => set(i, { key: e.target.value })} aria-label="Цвет" className="input min-w-0 flex-1">
                {allowAny && (
                  <optgroup label="Без цвета">
                    <option value="classic">{ANY.classic}</option>
                    <option value="double">{ANY.double}</option>
                  </optgroup>
                )}
                <optgroup label="Классические">{group("classic")}</optgroup>
                <optgroup label="Махровые">{group("double")}</optgroup>
              </select>
              <button
                type="button"
                onClick={() => onChange(lines.filter((_, j) => j !== i))}
                aria-label="Убрать строку"
                className="btn w-11 shrink-0 px-0 text-muted"
              >
                ✕
              </button>
            </div>
            <div className="mt-2 flex items-center gap-2">
              <button type="button" onClick={() => set(i, { packs: Math.max(1, l.packs - 1) })} aria-label="Меньше" className="btn w-11 px-0 text-lg">
                −
              </button>
              <input
                value={l.packs || ""}
                onChange={(e) => set(i, { packs: Number(e.target.value.replace(/\D/g, "")) })}
                inputMode="numeric"
                aria-label="Пачек"
                className="input w-16 text-center text-lg font-semibold"
              />
              <button type="button" onClick={() => set(i, { packs: l.packs + 1 })} aria-label="Больше" className="btn w-11 px-0 text-lg">
                +
              </button>
              <span className="text-sm text-muted">пач.</span>
              <span className="ml-auto text-right text-sm">
                {price ? (
                  <>
                    <span className="text-muted">
                      {price.qtyStems} шт × {tenge(price.unitPrice)}
                    </span>
                    <br />
                    <b>{tenge(price.lineTotal)}</b>
                  </>
                ) : (
                  <span className="text-up">нет цены</span>
                )}
              </span>
            </div>
          </div>
        );
      })}
      <button
        type="button"
        onClick={() => onChange([...lines, { key: allowAny ? "classic" : products[0]?.id ?? "", packs: 4 }])}
        className="btn w-full border-dashed text-muted"
      >
        + строка
      </button>
    </div>
  );
}
