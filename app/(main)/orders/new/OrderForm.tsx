"use client";

import { useState } from "react";
import { createOrderAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { LinesEditor } from "@/components/LinesEditor";
import { Field } from "@/components/ui";
import type { Rule } from "@/lib/calc";
import { normalizePhone, tenge } from "@/lib/format";
import { computeQuote, type LineState, type ProductOpt } from "@/lib/quote";
import { hoursFor, pctOptions, type SeasonSettings } from "@/lib/settings";

type Client = { phone: string; name: string; company: string | null };

// Controlled only where the form reacts while typing: phone → known client, lines / % / date → price and hours
export function OrderForm(p: {
  products: ProductOpt[];
  rules: Rule[];
  settings: SeasonSettings;
  today: string;
  pickupFrom: string;
  pickupTo: string;
  clients: Client[];
  initial: { lines: LineState[]; pct: number; date: string; phone: string };
}) {
  const [lines, setLines] = useState(p.initial.lines);
  const [f, setF] = useState({
    phone: p.initial.phone,
    name: "",
    company: "",
    pct: p.initial.pct,
    pickupDate: p.initial.date,
    storage: false,
  });
  const upd = (patch: Partial<typeof f>) => setF((x) => ({ ...x, ...patch }));
  const known = p.clients.find((c) => c.phone === normalizePhone(f.phone));

  const onPhone = (phone: string) => {
    const c = p.clients.find((x) => x.phone === normalizePhone(phone));
    upd({ phone, ...(c && !f.name && { name: c.name }), ...(c && !f.company && { company: c.company ?? "" }) });
  };

  const q = computeQuote({ ...p, lines, pct: f.pct, date: f.pickupDate || null, storage: f.storage });
  const blocking = [...q.problems, ...q.priced.missing.map(() => "Нет цены на сегодня — проверьте сетку цен")];
  const willBeNew = q.shortages.length > 0 || q.overThreshold;

  return (
    <ActionForm action={createOrderAction} className="space-y-4">
      <input type="hidden" name="lines" value={q.rows.map((r) => `${r.productId}:${r.qtyPacks}`).join(",")} />
      <input type="hidden" name="pct" value={f.pct} />

      <section className="card space-y-3">
        <Field label="Телефон">
          <input
            name="phone"
            type="tel"
            inputMode="tel"
            list="clients"
            value={f.phone}
            onChange={(e) => onPhone(e.target.value)}
            placeholder="+7 777 000 00 00"
            className="input"
            required
          />
          <datalist id="clients">
            {p.clients.map((c) => (
              <option key={c.phone} value={c.phone}>
                {[c.name, c.company].filter(Boolean).join(", ")}
              </option>
            ))}
          </datalist>
        </Field>
        {known && <p className="text-sm text-accent">Клиент уже есть в базе</p>}
        <div className="grid grid-cols-2 gap-3">
          <Field label="Имя">
            <input name="name" value={f.name} onChange={(e) => upd({ name: e.target.value })} className="input" />
          </Field>
          <Field label="Магазин / компания">
            <input name="company" value={f.company} onChange={(e) => upd({ company: e.target.value })} className="input" />
          </Field>
        </div>
      </section>

      <LinesEditor lines={lines} onChange={setLines} products={p.products} allowAny={false} prices={q.prices} />

      <section className="card space-y-3">
        <div>
          <span className="label">Предоплата</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label="Предоплата">
            {pctOptions(p.settings).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => upd({ pct: v })}
                aria-pressed={v === f.pct}
                className={`btn min-h-10 min-w-12 px-2 ${v === f.pct ? "btn-primary" : ""}`}
              >
                {v}%
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Дата выдачи">
            <input
              name="pickupDate"
              type="date"
              min={p.pickupFrom}
              max={p.pickupTo}
              value={f.pickupDate}
              onChange={(e) => upd({ pickupDate: e.target.value })}
              className="input"
            />
          </Field>
          <Field label={`Время (${hoursFor(p.settings, f.pickupDate || null)})`}>
            <input name="pickupTime" type="time" className="input" />
          </Field>
        </div>
        <div className="flex flex-wrap gap-4 text-sm">
          {[
            ["self_pickup", "Самовывоз"],
            ["client_truck", "Машина клиента"],
          ].map(([v, label]) => (
            <label key={v} className="flex items-center gap-2">
              <input type="radio" name="pickupMethod" value={v} defaultChecked={v === "self_pickup"} className="size-5" />
              {label}
            </label>
          ))}
          <label className="flex items-center gap-2">
            <input type="checkbox" name="storage" checked={f.storage} onChange={(e) => upd({ storage: e.target.checked })} className="size-5" />
            Холодильник до вывоза · {tenge(p.settings.storage_fee_per_day)} в сутки
          </label>
        </div>
        <Field label="Откуда заказ">
          <select name="channel" className="input">
            <option value="whatsapp">WhatsApp</option>
            <option value="instagram">Instagram</option>
            <option value="telegram">Telegram</option>
            <option value="phone">Звонок</option>
            <option value="in_person">Лично</option>
          </select>
        </Field>
        <Field label="Комментарий клиента">
          <textarea name="commentClient" rows={2} className="input" />
        </Field>
        <Field label="Внутренний комментарий (клиент не видит)">
          <textarea name="commentInternal" rows={2} className="input" />
        </Field>
      </section>

      <section className="card space-y-1">
        <div className="flex items-baseline justify-between">
          <span className="text-muted">Итого</span>
          <span className="text-3xl font-extrabold tabular-nums">{tenge(q.total)}</span>
        </div>
        {q.storage.fee > 0 && (
          <div className="flex justify-between text-sm">
            <span className="text-muted">Холодильник {q.storage.days} дн.</span>
            <span className="tabular-nums">{tenge(q.storage.fee)}</span>
          </div>
        )}
        <div className="flex justify-between text-sm">
          <span className="text-muted">Предоплата {f.pct}%</span>
          <b className="tabular-nums">{tenge(q.prepayment)}</b>
        </div>
        <p className={`pt-2 text-sm ${willBeNew ? "text-warn" : "text-accent"}`}>
          {willBeNew
            ? `Сохранится как «Новый» — ${q.shortages.length ? `не хватает: ${q.shortages.join("; ")}` : `от ${tenge(p.settings.check_threshold_amount)} нужна проверка`}. Подтвердите позже в карточке.`
            : `Сохранится как «Бронь» на ${p.settings.hold_days} дн. без предоплаты.`}
        </p>
      </section>

      {blocking.length > 0 && (
        <ul className="space-y-1 rounded-xl bg-warn-bg p-3 text-sm text-warn">
          {blocking.map((w) => (
            <li key={w}>{w}</li>
          ))}
        </ul>
      )}
      <Submit className={`btn-primary w-full ${blocking.length ? "pointer-events-none opacity-50" : ""}`}>Сохранить заказ</Submit>
    </ActionForm>
  );
}
