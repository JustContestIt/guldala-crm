import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clientAction, draftAction, muteAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Composer } from "@/components/Composer";
import { Field, StatusBadge } from "@/components/ui";
import { dmhm, prettyPhone, tenge } from "@/lib/format";
import { seasonOpenText } from "@/lib/templates";
import { currentSeason } from "@/services/catalog";
import { CLIENT_TYPES, clientCard, previousSeason, tookIn } from "@/services/clients";
import { clientChat } from "@/services/messages";

export const metadata: Metadata = { title: "Клиент" };

const WHO = { client: "Клиент", operator: "Татьяна", system: "CRM", assistant: "Бот" } as const;
const SENT = { draft: "черновик", queued: "отправляется", sent: "отправлено", delivered: "доставлено", read: "прочитано", error: "не отправлено" } as const;

export default async function ClientPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ msg?: string }> }) {
  const [{ id }, { msg }] = await Promise.all([params, searchParams]);
  const card = await clientCard(id);
  if (!card) notFound();
  const { client: c, orders } = card;
  const season = await currentSeason();
  const prev = season && (await previousSeason(season));
  const took = prev && (await tookIn(prev.id, [c.id])).get(c.id);
  const templates = [
    ...(season && took ? [{ key: "season_open", label: "Открыли сезон", text: seasonOpenText(season.peakDate.slice(0, 4), took) }] : []),
    { key: "message", label: "Своё сообщение", text: "" },
  ];
  const bySeason = Map.groupBy(orders, (o) => o.season);
  const chat = await clientChat(c.id);
  const drafts = chat?.messages.filter((m) => m.status === "draft") ?? [];

  return (
    <div className="space-y-4">
      <Link href="/clients" className="text-sm text-muted">
        ← Клиенты
      </Link>
      <header className="space-y-1">
        <h1>{c.company || c.name || prettyPhone(c.phone)}</h1>
        {c.company && c.name && <p className="font-semibold">{c.name}</p>}
        <p className="flex flex-wrap gap-3 text-sm">
          <a href={`tel:${c.phone}`} className="text-accent underline">
            {prettyPhone(c.phone)}
          </a>
          <a href={`https://wa.me/${c.phone.slice(1)}`} target="_blank" rel="noopener noreferrer" className="text-accent underline">
            WhatsApp
          </a>
        </p>
      </header>
      <Link href={`/orders/new?phone=${encodeURIComponent(c.phone)}`} className="btn btn-primary w-full">
        Новый заказ
      </Link>

      <section className="card space-y-3">
        <h2>Заказы</h2>
        {[...bySeason].map(([name, list]) => {
          const live = list.filter((o) => o.status !== "expired" && o.status !== "cancelled");
          return (
            <div key={name}>
              <p className="text-sm text-muted">
                {name}: {live.reduce((a, o) => a + o.packs, 0)} пач. · {tenge(live.reduce((a, o) => a + o.total, 0))}
              </p>
              <ul className="divide-y divide-line">
                {list.map((o) => (
                  <li key={o.id}>
                    <Link href={`/orders/${o.id}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span className="tabular-nums">
                        {o.number} · {o.packs} пач. · {tenge(o.total)}
                      </span>
                      <StatusBadge status={o.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {!orders.length && <p className="text-sm text-muted">Заказов не было</p>}
      </section>

      {chat && (
        <section id="chat" className="card space-y-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2>Переписка</h2>
            <ActionForm action={muteAction} className="flex flex-wrap items-center gap-2">
              <input type="hidden" name="conversationId" value={chat.conversation.id} />
              <span className="text-sm text-muted">
                {chat.conversation.assistantMutedAt ? `Бот молчит с ${dmhm(chat.conversation.assistantMutedAt)}` : "Бот отвечает"}
              </span>
              {chat.conversation.assistantMutedAt ? (
                <Submit name="muted" value="0" className="btn-primary min-h-9 px-3 text-xs">
                  Включить
                </Submit>
              ) : (
                <Submit name="muted" value="1" className="min-h-9 px-3 text-xs">
                  Выключить
                </Submit>
              )}
            </ActionForm>
          </div>
          {drafts.map((d) => (
            <ActionForm key={d.id} action={draftAction} className="space-y-2 rounded-xl border border-accent bg-mint p-3">
              <input type="hidden" name="id" value={d.id} />
              <p className="text-xs font-semibold text-accent-dark">Черновик бота · {dmhm(d.createdAt)}</p>
              <textarea name="text" aria-label="Текст черновика" defaultValue={d.text} rows={Math.min(10, Math.ceil(d.text.length / 35) + 1)} className="input text-sm" />
              <div className="grid grid-cols-2 gap-2">
                <Submit name="op" value="send">
                  Отправить
                </Submit>
                <Submit name="op" value="delete" className="btn-danger" confirm="Удалить черновик?">
                  Удалить
                </Submit>
              </div>
            </ActionForm>
          ))}
          <ul className="space-y-2">
            {chat.messages
              .filter((m) => m.status !== "draft")
              .map((m) => (
                <li key={m.id} className={`rounded-xl px-3 py-2 text-sm ${m.direction === "in" ? "mr-8 bg-surface" : "ml-8 bg-mint"}`}>
                  <p className="text-xs text-muted">
                    {WHO[m.author]}
                    {m.isEcho && " с телефона"} · {dmhm(m.createdAt)}
                    {m.direction === "out" && !m.isEcho && ` · ${SENT[m.status]}`}
                  </p>
                  <p className="whitespace-pre-wrap">{m.text}</p>
                  {m.status === "error" && m.error && <p className="text-xs text-up">{m.error}</p>}
                </li>
              ))}
          </ul>
        </section>
      )}

      <section id="msg" className="card space-y-2">
        <h2>Написать</h2>
        <Composer key={templates[0].text} templates={templates} phone={c.phone} initial={msg} orderLink />
      </section>

      <section className="card">
        <ActionForm action={clientAction} className="grid grid-cols-2 gap-3">
          <input type="hidden" name="id" value={c.id} />
          <Field label="Имя">
            <input name="name" defaultValue={c.name} className="input" />
          </Field>
          <Field label="Магазин / компания">
            <input name="company" defaultValue={c.company ?? ""} className="input" />
          </Field>
          <Field label="Тип" className="col-span-2">
            <select name="clientType" defaultValue={c.clientType} className="input">
              {Object.entries(CLIENT_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Заметки (клиент не видит)" className="col-span-2">
            <textarea name="notes" rows={3} defaultValue={c.notes} className="input" />
          </Field>
          <div className="col-span-2">
            <Submit>Сохранить</Submit>
          </div>
        </ActionForm>
      </section>
    </div>
  );
}
