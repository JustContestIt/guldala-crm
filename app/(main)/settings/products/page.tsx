import type { Metadata } from "next";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink, Field } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { currentSeason, stockTable, tulips, type Product, type Season } from "@/services/catalog";
import { COLORS } from "@/services/settings";
import { saveProductAction } from "../actions";

export const metadata: Metadata = { title: "Товары" };

type Stock = { planned: number | null; adjusted: number; reserved: number; issued: number; available: number };
const NONE: Stock = { planned: null, adjusted: 0, reserved: 0, issued: 0, available: 0 };
const packs = (stems: number, p?: Product) => Math.floor(stems / (p?.packSize ?? 30));
const total = (s: Stock) => (s.planned ?? 0) + s.adjusted;

// One form for a product and its stock (Nikita 09.11.2026): the packs typed here are the season total; a change of an existing total needs a reason
function ProductForm({ p, s, season, next }: { p?: Product; s: Stock; season: Season | null; next: number }) {
  const open = season && season.status !== "closed";
  return (
    <ActionForm action={saveProductAction} className="grid grid-cols-2 gap-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Название" className="col-span-2">
        <input name="name" className="input" defaultValue={p?.name} placeholder="Жёлтый махровый" required />
      </Field>
      <Field label="Тип">
        <select name="tulipType" className="input" defaultValue={p?.tulipType ?? "classic"}>
          <option value="classic">классический</option>
          <option value="double">махровый</option>
        </select>
      </Field>
      <Field label="Цвет на сайте">
        <select name="color" className="input" defaultValue={p?.color && p.color in COLORS ? p.color : ""} required>
          <option value="" disabled>
            выберите
          </option>
          {Object.entries(COLORS).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Сорта внутри" className="col-span-2">
        <input name="varieties" className="input" defaultValue={p?.varieties ?? ""} placeholder="Cadenza, Monte Carlo" />
      </Field>
      {open && (
        <>
          <input type="hidden" name="seasonId" value={season.id} />
          <Field label="Всего пачек" className={s.planned === null ? "col-span-2" : ""}>
            <input name="packs" inputMode="numeric" className="input" placeholder="0" defaultValue={s.planned === null ? "" : packs(total(s), p)} />
          </Field>
          {s.planned !== null && (
            <Field label="Причина, если меняете">
              <input name="reason" className="input" placeholder="пересчёт, брак…" />
            </Field>
          )}
          {s.reserved + s.issued > 0 && (
            <p className="col-span-2 -mt-2 text-xs text-muted">
              В заказах {packs(s.reserved + s.issued, p)} пач. — меньше этого не ставьте, иначе заказам не хватит.
            </p>
          )}
        </>
      )}
      <Field label="Место в списке">
        <input name="sortOrder" inputMode="numeric" className="input" defaultValue={p?.sortOrder ?? next} />
      </Field>
      <label className="flex items-end gap-2 pb-3 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} className="size-5" />
        В продаже
      </label>
      <div className="col-span-2">
        <Submit>{p ? "Сохранить" : "Добавить товар"}</Submit>
      </div>
    </ActionForm>
  );
}

export default async function ProductsPage() {
  await requireOwner();
  const season = await currentSeason();
  const rows = season ? await stockTable(season.id) : (await tulips()).map((product) => ({ product, ...NONE }));
  const next = Math.max(0, ...rows.map((r) => r.product.sortOrder)) + 1;
  return (
    <div className="space-y-4">
      <BackLink href="/more">Ещё</BackLink>
      <h1>Товары</h1>
      <p className="text-sm text-muted">
        Товар — цвет и тип тюльпана, например «Жёлтый махровый»; сорта вписываются внутрь. Сайт и бот показывают его в выбранном цвете. Цена — по сетке
        сезона для типа. Нажмите на товар, чтобы изменить его или количество
        {season && season.status !== "closed" && ` — пачки считаются на сезон «${season.name}»`}.
      </p>

      <details className="card" open={!rows.length}>
        <summary className="font-semibold text-accent">+ Новый товар</summary>
        <div className="mt-3">
          <ProductForm s={NONE} season={season} next={next} />
        </div>
      </details>

      {rows.map(({ product: p, ...s }) => (
        <details key={p.id} className="card">
          <summary className="flex flex-wrap items-baseline justify-between gap-x-3">
            <span className={`font-medium ${p.isActive ? "" : "text-muted line-through"}`}>{p.name}</span>
            {season && (
              <span className={`text-sm tabular-nums ${s.planned === null ? "text-warn" : "text-muted"}`}>
                {s.planned === null ? "количество не задано" : `свободно ${packs(Math.max(0, s.available), p)} из ${packs(total(s), p)} пач.`}
              </span>
            )}
          </summary>
          <div className="mt-3">
            <ProductForm p={p} s={s} season={season} next={next} />
          </div>
        </details>
      ))}
    </div>
  );
}
