import type { Metadata } from "next";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink, Field } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { importClientsAction } from "../actions";

export const metadata: Metadata = { title: "Импорт клиентов" };

export default async function ImportClientsPage() {
  await requireOwner();
  return (
    <div className="space-y-4">
      <BackLink href="/clients">Клиенты</BackLink>
      <h1>Импорт клиентов</h1>
      <p className="text-sm text-muted">
        Вставьте список из Excel, Google-таблицы или заметок: одна строка — один клиент. В строке телефон и, если есть, имя и магазин —
        через табуляцию, точку с запятой или запятую. Строки без телефона пропустятся. У тех, кто уже есть в базе, дополнятся только
        пустые имя и магазин.
      </p>
      <ActionForm action={importClientsAction} className="card space-y-3">
        <Field label="Список">
          <textarea name="text" rows={8} className="input font-mono text-sm" placeholder={"+7 777 123 45 67; Айгуль; Цветы на Абая\n87011234567, Ерлан"} />
        </Field>
        <Field label="Или файл .csv / .txt">
          <input name="file" type="file" accept=".csv,.txt,text/csv,text/plain" className="input py-2 text-sm" />
        </Field>
        <Submit className="btn-primary w-full">Загрузить</Submit>
      </ActionForm>
    </div>
  );
}
