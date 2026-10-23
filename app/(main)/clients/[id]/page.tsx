import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { clientAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "@/components/ActionForm";
import { Composer } from "@/components/Composer";
import { Field, StatusBadge } from "@/components/ui";
import { prettyPhone, tenge } from "@/lib/format";
import { seasonOpenText } from "@/lib/templates";
import { currentSeason } from "@/services/catalog";
import { CLIENT_TYPES, clientCard, previousSeason, tookIn } from "@/services/clients";

export const metadata: Metadata = { title: "Клиент" };

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
