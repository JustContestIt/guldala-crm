"use client";

import { useRef, useState } from "react";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Field } from "@/components/ui";
import { prettyPhone } from "@/lib/format";
import { BROADCAST_VARS, fillBroadcast } from "@/lib/templates";
import { broadcastAction } from "../actions";

type Recipient = { id: string; name: string; company: string | null; phone: string };
const who = (r: Recipient) => r.company || r.name || prettyPhone(r.phone);

// The list comes ticked; untick whoever shouldn't get it, or «Снять все» and tick a few for a personal message
export function BroadcastForm({ recipients }: { recipients: Recipient[] }) {
  const [text, setText] = useState("");
  const [off, setOff] = useState<Set<string>>(new Set());
  const box = useRef<HTMLTextAreaElement>(null);
  const chosen = recipients.filter((r) => !off.has(r.id));
  const sample = chosen[0];
  const toggle = (id: string) =>
    setOff((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });

  // {имя} / {магазин} go where the cursor is
  const insert = (v: string) => {
    const el = box.current;
    const at = el?.selectionStart ?? text.length;
    setText(text.slice(0, at) + v + text.slice(el?.selectionEnd ?? at));
    requestAnimationFrame(() => el?.focus());
  };

  return (
    <ActionForm action={broadcastAction} className="space-y-4">
      {chosen.map((r) => (
        <input key={r.id} type="hidden" name="ids" value={r.id} />
      ))}
      <section className="card space-y-3">
        <Field label="Текст">
          <textarea
            ref={box}
            name="text"
            rows={5}
            maxLength={2000}
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder="Здравствуйте, {имя}! Открыли приём заказов на тюльпаны…"
            className="input"
            required
          />
        </Field>
        <div className="flex flex-wrap gap-2">
          {BROADCAST_VARS.map((v) => (
            <button key={v} type="button" className="btn min-h-9 px-3 text-xs" onClick={() => insert(v)}>
              + {v}
            </button>
          ))}
        </div>
        {sample && text.trim() && (
          <div className="rounded-xl bg-mint p-3 text-sm">
            <p className="text-xs text-muted">Так увидит {who(sample)}</p>
            <p className="mt-1 whitespace-pre-wrap">{fillBroadcast(text.trim(), sample)}</p>
          </div>
        )}
        <Submit className="btn-primary w-full" confirm={`Отправить ${chosen.length} клиентам? Сообщения уйдут по одному, с паузой.`}>
          Отправить {chosen.length} {chosen.length % 10 === 1 && chosen.length % 100 !== 11 ? "клиенту" : "клиентам"}
        </Submit>
      </section>

      <section className="card space-y-2 p-0">
        <div className="flex items-center justify-between gap-2 px-4 pt-3">
          <h2>
            Получатели: {chosen.length} из {recipients.length}
          </h2>
          <button type="button" className="btn min-h-9 px-3 text-xs" onClick={() => setOff(chosen.length ? new Set(recipients.map((r) => r.id)) : new Set())}>
            {chosen.length ? "Снять все" : "Отметить все"}
          </button>
        </div>
        <ul className="divide-y divide-line">
          {recipients.map((r) => (
            <li key={r.id}>
              <label className="flex min-h-12 items-center gap-3 px-4 py-2 text-sm">
                <input type="checkbox" checked={!off.has(r.id)} onChange={() => toggle(r.id)} className="size-5" />
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{who(r)}</span>
                  <span className="block text-muted">{[r.company && r.name, prettyPhone(r.phone)].filter(Boolean).join(" · ")}</span>
                </span>
              </label>
            </li>
          ))}
          {!recipients.length && <li className="px-4 py-6 text-center text-muted">В этом списке никого нет</li>}
        </ul>
      </section>
    </ActionForm>
  );
}
