import type { Metadata } from "next";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink, Field } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { CLIENT_TYPES } from "@/services/clients";
import { createClientAction } from "../actions";

export const metadata: Metadata = { title: "Новый клиент" };

export default async function NewClientPage() {
  await requireOwner();
  return (
    <div className="space-y-4">
      <BackLink href="/clients">Клиенты</BackLink>
      <h1>Новый клиент</h1>
      <ActionForm action={createClientAction} className="card grid grid-cols-2 gap-3">
        <Field label="Телефон (WhatsApp)" className="col-span-2">
          <input name="phone" type="tel" inputMode="tel" placeholder="+7 777 000 00 00" className="input" required />
        </Field>
        <Field label="Имя">
          <input name="name" className="input" />
        </Field>
        <Field label="Магазин / компания">
          <input name="company" className="input" />
        </Field>
        <Field label="Тип" className="col-span-2">
          <select name="clientType" className="input" defaultValue="flower_shop">
            {Object.entries(CLIENT_TYPES).map(([k, label]) => (
              <option key={k} value={k}>
                {label}
              </option>
            ))}
          </select>
        </Field>
        <Field label="Заметки (клиент не видит)" className="col-span-2">
          <textarea name="notes" rows={3} className="input" />
        </Field>
        <div className="col-span-2">
          <Submit className="btn-primary w-full">Добавить клиента</Submit>
        </div>
      </ActionForm>
    </div>
  );
}
