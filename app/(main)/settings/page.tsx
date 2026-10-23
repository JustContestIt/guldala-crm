import { desc } from "drizzle-orm";
import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { db } from "@/db";
import { seasons } from "@/db/schema";
import { requireOwner } from "@/lib/auth";
import { dm } from "@/lib/format";
import { SEASON_STATUS } from "@/lib/settings";
import { createSeasonAction } from "./actions";

export const metadata: Metadata = { title: "Сезоны" };

export default async function SettingsPage() {
  await requireOwner();
  const list = await db.select().from(seasons).orderBy(desc(seasons.peakDate));
  return (
    <div className="space-y-4">
      <h1>Сезоны</h1>
      <ul className="card divide-y divide-line p-0">
        {list.map((s) => (
          <li key={s.id}>
            <Link href={`/settings/seasons/${s.id}`} className="flex items-center justify-between gap-3 px-4 py-3">
              <span className="font-medium">{s.name}</span>
              <span className="text-sm text-muted">
                {SEASON_STATUS[s.status]} · выдача {dm(s.pickupFrom)}–{dm(s.pickupTo)}
              </span>
            </Link>
          </li>
        ))}
        {!list.length && <li className="px-4 py-3 text-muted">Сезонов пока нет</li>}
      </ul>

      <details className="card">
        <summary className="font-semibold">Новый сезон</summary>
        <ActionForm action={createSeasonAction} className="mt-3 grid grid-cols-2 gap-3">
          <Field label="Название" className="col-span-2">
            <input name="name" className="input" placeholder="Тюльпаны 2028" required />
          </Field>
          <Field label="Приём заказов с">
            <input name="ordersOpenFrom" type="date" className="input" required />
          </Field>
          <Field label="Пиковая дата">
            <input name="peakDate" type="date" className="input" required />
          </Field>
          <Field label="Выдача с">
            <input name="pickupFrom" type="date" className="input" required />
          </Field>
          <Field label="Выдача по">
            <input name="pickupTo" type="date" className="input" required />
          </Field>
          <div className="col-span-2">
            <Submit>Создать</Submit>
          </div>
        </ActionForm>
      </details>
    </div>
  );
}
