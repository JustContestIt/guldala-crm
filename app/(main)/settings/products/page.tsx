import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { tulips, type Product } from "@/services/catalog";
import { saveProductAction } from "../actions";

export const metadata: Metadata = { title: "Цвета" };

function ProductForm({ p, next }: { p?: Product; next: number }) {
  return (
    <ActionForm action={saveProductAction} className="grid grid-cols-2 gap-3">
      {p && <input type="hidden" name="id" value={p.id} />}
      <Field label="Название" className="col-span-2">
        <input name="name" className="input" defaultValue={p?.name} placeholder="Красный классический" required />
      </Field>
      <Field label="Тип">
        <select name="tulipType" className="input" defaultValue={p?.tulipType ?? "classic"}>
          <option value="classic">классический</option>
          <option value="double">махровый</option>
        </select>
      </Field>
      <Field label="Цвет">
        <input name="color" className="input" defaultValue={p?.color ?? ""} placeholder="red" />
      </Field>
      <Field label="Сорта внутри цвета" className="col-span-2">
        <input name="varieties" className="input" defaultValue={p?.varieties ?? ""} placeholder="Strong Gold, Yellow Flight" />
      </Field>
      <Field label="Порядок">
        <input name="sortOrder" inputMode="numeric" className="input" defaultValue={p?.sortOrder ?? next} />
      </Field>
      <label className="flex items-end gap-2 pb-3 text-sm">
        <input type="checkbox" name="isActive" defaultChecked={p?.isActive ?? true} className="size-5" />
        В продаже
      </label>
      <div className="col-span-2">
        <Submit>{p ? "Сохранить" : "Добавить"}</Submit>
      </div>
    </ActionForm>
  );
}

export default async function ProductsPage() {
  await requireOwner();
  const list = await tulips();
  const next = Math.max(0, ...list.map((p) => p.sortOrder)) + 1;
  return (
    <div className="space-y-4">
      <Link href="/more" className="text-sm text-muted">
        ← Ещё
      </Link>
      <h1>Цвета</h1>
      <p className="text-sm text-muted">Единица учёта и продажи — цвет × тип, не сорт. План по цвету задаётся в сезоне.</p>
      {list.map((p) => (
        <details key={p.id} className="card">
          <summary className={`font-medium ${p.isActive ? "" : "text-muted line-through"}`}>{p.name}</summary>
          <div className="mt-3">
            <ProductForm p={p} next={next} />
          </div>
        </details>
      ))}
      <details className="card" open={!list.length}>
        <summary className="font-semibold">Новый цвет</summary>
        <div className="mt-3">
          <ProductForm next={next} />
        </div>
      </details>
    </div>
  );
}
