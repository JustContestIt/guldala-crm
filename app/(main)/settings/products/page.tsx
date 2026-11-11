import { desc, eq } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink, Field, StatusBadge } from "@/components/ui";
import { db } from "@/db";
import { products, stockAdjustments, users } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import type { Status } from "@/lib/calc";
import { dm, dmhm } from "@/lib/format";
import { SEASON_STATUS } from "@/lib/settings";
import { currentSeason, holds, stockTable, tulips, type Product, type Season } from "@/services/catalog";
import { expireHolds } from "@/services/orders";
import { COLORS } from "@/services/settings";
import { deleteProductAction, packSizeAction, saveProductAction } from "../actions";

export const metadata: Metadata = { title: "Склад" };

type Stock = { planned: number | null; adjusted: number; reserved: number; issued: number; available: number };
type Hold = Awaited<ReturnType<typeof holds>>[number];
const NONE: Stock = { planned: null, adjusted: 0, reserved: 0, issued: 0, available: 0 };
const packs = (stems: number, p?: Product) => Math.floor(stems / (p?.packSize ?? 30));
const total = (s: Stock) => (s.planned ?? 0) + s.adjusted;
const stemsOf = (hs: Hold[], st: Status[]) => hs.filter((h) => st.includes(h.status)).reduce((a, h) => a + h.qtyStems, 0);
// the «Брони» tab's filter (review 09.11.2026, К6а)
const FILTER: Record<string, { label: string; st: Status[] }> = {
  "": { label: "Все", st: ["confirmed", "prepaid", "ready"] },
  confirmed: { label: "Бронь", st: ["confirmed"] },
  prepaid: { label: "Оплачено", st: ["prepaid"] },
  ready: { label: "На выдачу", st: ["ready"] },
};
const chip = (on: boolean) => `shrink-0 rounded-full border px-3 py-1.5 text-sm ${on ? "border-accent bg-accent text-white" : "border-line bg-white"}`;

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

// Who holds this product: a tap opens the order, where the hold itself is changed (К7)
function HoldList({ hs }: { hs: Hold[] }) {
  return (
    <ul className="divide-y divide-line text-sm">
      {hs.map((h, i) => (
        <li key={`${h.orderId}-${i}`} className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 py-2">
          <Link href={`/orders/${h.orderId}`} className="min-w-0 flex-1">
            <span className="font-semibold text-accent underline">{h.number}</span> · {h.client}
            <span className="block text-muted">
              {h.qtyPacks} пач.{h.issuedStems > 0 && ` · выдано ${h.issuedStems} шт`}
              {h.pickupDate && ` · выдача ${dm(h.pickupDate)}`}
            </span>
          </Link>
          <StatusBadge status={h.status} />
        </li>
      ))}
    </ul>
  );
}

export default async function ProductsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwner();
  await expireHolds(); // a hold past its time no longer holds
  const sp = await searchParams;
  const tab = sp.tab === "holds" ? "holds" : "products";
  const filter = FILTER[sp.status ?? ""] ? (sp.status ?? "") : "";
  const season = await currentSeason();
  const rows = season ? await stockTable(season.id) : (await tulips()).map((product) => ({ product, ...NONE }));
  const held = season ? await holds(season.id) : [];
  const next = Math.max(0, ...rows.map((r) => r.product.sortOrder)) + 1;
  // what changed the totals and why: the seller's record of «пересчёт, брак…» (was on the season page until 09.11.2026)
  const history =
    season && tab === "products"
      ? await db
          .select({ a: stockAdjustments, product: products.name, by: users.name })
          .from(stockAdjustments)
          .innerJoin(products, eq(products.id, stockAdjustments.productId))
          .leftJoin(users, eq(users.id, stockAdjustments.createdBy))
          .where(eq(stockAdjustments.seasonId, season.id))
          .orderBy(desc(stockAdjustments.createdAt))
      : [];
  const shown = held.filter((h) => FILTER[filter].st.includes(h.status));

  return (
    <div className="space-y-4">
      <BackLink href="/more">Настройки</BackLink>
      <h1>Склад товаров</h1>
      {/* which season the packs are counted for, in sight (review 09.11.2026, К5) */}
      <p className={`rounded-xl px-4 py-3 text-lg font-bold ${season ? "bg-mint text-accent-dark" : "bg-warn-bg text-warn"}`}>
        {season ? `Остатки на сезон «${season.name}» · ${SEASON_STATUS[season.status].toLowerCase()}` : "Сезона нет — остатки не считаются"}
      </p>
      <nav className="flex gap-2" aria-label="Разделы склада">
        <Link href="/settings/products" className={chip(tab === "products")}>
          Товары
        </Link>
        <Link href="/settings/products?tab=holds" className={chip(tab === "holds")}>
          Брони · {new Set(held.map((h) => h.orderId)).size}
        </Link>
      </nav>

      {tab === "holds" ? (
        <>
          <p className="text-sm text-muted">Все отложенные тюльпаны: у кого какие забронированы или оплачены. Изменить бронь — в заказе, нажмите на номер.</p>
          <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4">
            {Object.entries(FILTER).map(([k, f]) => (
              <Link key={k} href={`/settings/products?tab=holds${k ? `&status=${k}` : ""}`} className={chip(filter === k)}>
                {f.label}
              </Link>
            ))}
          </div>
          {rows
            .map((r) => ({ p: r.product, hs: shown.filter((h) => h.productId === r.product.id) }))
            .filter((g) => g.hs.length)
            .map(({ p, hs }) => (
              <section key={p.id} id={`p-${p.id}`} className="card scroll-mt-4 space-y-1">
                <h2 className="flex items-baseline justify-between gap-3">
                  {p.name} <span className="text-sm font-normal text-muted tabular-nums">{packs(stemsOf(hs, FILTER[filter].st), p)} пач.</span>
                </h2>
                <HoldList hs={hs} />
              </section>
            ))}
          {!shown.length && <p className="card text-center text-muted">Броней нет</p>}
        </>
      ) : (
        <>
          <p className="text-sm text-muted">
            Товар — цвет и тип тюльпана, например «Жёлтый махровый»; сорта вписываются внутрь. Сайт и бот показывают его в выбранном цвете. Цена — по сетке
            сезона для типа. Нажмите на товар, чтобы увидеть, у кого он в заказах, изменить его или количество.
          </p>

          {season && (
            // review 09.11.2026, К9: «количество цветков в пачке изменяемое»
            <ActionForm action={packSizeAction} className="card flex flex-wrap items-end gap-3">
              <input type="hidden" name="seasonId" value={season.id} />
              <Field label="Цветков в пачке" className="w-36">
                <input name="packSize" inputMode="numeric" className="input text-lg font-semibold" defaultValue={season.settings.pack_size} required />
              </Field>
              <Submit>Сохранить</Submit>
              <p className="w-full text-xs text-muted">
                По этому числу считают новые заказы, сайт и бот. Уже оформленные заказы не меняются. Остатки хранятся в цветках: с другим размером пачки число
                пачек на складе пересчитается — проверьте «Всего пачек».
              </p>
            </ActionForm>
          )}

          <details className="card" open={!rows.length}>
            <summary className="font-semibold text-accent">+ Новый товар</summary>
            <div className="mt-3">
              <ProductForm s={NONE} season={season} next={next} />
            </div>
          </details>

          {rows.map(({ product: p, ...s }) => {
            const hs = held.filter((h) => h.productId === p.id);
            return (
              <details key={p.id} className="card">
                <summary className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className={`font-medium ${p.isActive ? "" : "text-muted line-through"}`}>{p.name}</span>
                  {season && (
                    <span className={`text-sm tabular-nums ${s.planned === null ? "text-warn" : "text-muted"}`}>
                      {s.planned === null ? "количество не задано" : `свободно ${packs(Math.max(0, s.available), p)} из ${packs(total(s), p)} пач.`}
                    </span>
                  )}
                </summary>
                <div className="mt-3 space-y-3">
                  {season && s.planned !== null && (
                    // review 09.11.2026, К6: «сколько всего, сколько в заказе, у кого в заказе»
                    <dl className="grid grid-cols-3 gap-2 text-center text-sm sm:grid-cols-5">
                      {(
                        [
                          ["Всего", total(s)],
                          ["В брони", stemsOf(hs, ["confirmed"])],
                          ["Оплачено", stemsOf(hs, ["prepaid", "ready"])],
                          ["Выдано", s.issued],
                          ["Свободно", Math.max(0, s.available)],
                        ] as const
                      ).map(([k, v]) => (
                        <div key={k} className="rounded-xl bg-surface px-2 py-1.5">
                          <dt className="text-xs text-muted">{k}</dt>
                          <dd className="text-lg font-bold tabular-nums">{packs(v, p)}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  {hs.length > 0 && (
                    <div>
                      <p className="text-sm font-semibold">
                        У кого в заказах ·{" "}
                        <Link href={`/settings/products?tab=holds#p-${p.id}`} className="font-normal text-accent underline">
                          все брони
                        </Link>
                      </p>
                      <HoldList hs={hs} />
                    </div>
                  )}
                  <ProductForm p={p} s={s} season={season} next={next} />
                  <ActionForm action={deleteProductAction}>
                    <input type="hidden" name="id" value={p.id} />
                    <Submit className="w-full text-up" confirm={`Удалить «${p.name}» насовсем? Вернуть его будет нельзя.`}>
                      Удалить товар
                    </Submit>
                  </ActionForm>
                </div>
              </details>
            );
          })}

          {history.length > 0 && (
            <section className="card space-y-2">
              <h2>Изменения количества</h2>
              <ul className="space-y-1 text-sm">
                {history.map(({ a, product, by }) => (
                  <li key={a.id} className="text-muted">
                    {dmhm(a.createdAt)} · {product} {a.deltaStems > 0 ? "+" : ""}
                    {a.deltaStems} шт · {a.reason}
                    {by && ` · ${by}`}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
