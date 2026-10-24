import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { AutoRefresh } from "@/components/AutoRefresh";
import { BackLink } from "@/components/ui";
import { requireOwner } from "@/lib/auth";
import { dmhm, prettyPhone } from "@/lib/format";
import { broadcastFailures, broadcastList, MAX_RECIPIENTS, PAUSE_S } from "@/services/broadcast";
import { currentSeason } from "@/services/catalog";
import { CLIENT_TYPES, clientList, lapsedClients, SEGMENTS, type ClientType, type Segment } from "@/services/clients";
import { broadcastControlAction } from "../actions";
import { BroadcastForm } from "./BroadcastForm";

export const metadata: Metadata = { title: "Рассылка" };

const SEG_LABEL = { "": "Все", season: SEGMENTS.season, lapsed: "Брали в прошлом сезоне, в этом нет", none: SEGMENTS.none } as const;

// One text to many clients (Nikita 24.10.2026): who gets it — the client base filters; the text — general or with {имя} / {магазин}
export default async function BroadcastPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireOwner();
  const sp = await searchParams;
  const seg = (Object.hasOwn(SEG_LABEL, sp.seg ?? "") ? (sp.seg ?? "") : "") as keyof typeof SEG_LABEL;
  const type = Object.hasOwn(CLIENT_TYPES, sp.type ?? "") ? (sp.type as ClientType) : null;
  const season = await currentSeason();
  const rows =
    seg === "lapsed"
      ? season
        ? (await lapsedClients(season)).rows
        : []
      : await clientList({ q: sp.q ?? "", type, seg: (seg || null) as Segment | null, seasonId: season?.id }, MAX_RECIPIENTS + 1);
  const recipients = rows.map((r) => ({ id: r.id, name: r.name, company: r.company, phone: r.phone }));
  const list = await broadcastList();
  const failures = await Promise.all(list.map((b) => (b.failed ? broadcastFailures(b.key) : [])));

  return (
    <div className="space-y-4">
      <BackLink href="/clients">Клиенты</BackLink>
      <h1>Рассылка</h1>
      <p className="text-sm text-muted">
        Сообщения уходят по одному, с паузой {PAUSE_S[0]}–{PAUSE_S[1]} с: WhatsApp блокирует номер за поток одинаковых сообщений. Обращайтесь по
        имени — {"{имя}"} подставится каждому. Каждое сообщение видно в переписке клиента.
      </p>

      {list.length > 0 && (
        <section className="card space-y-3">
          <h2>Последние рассылки</h2>
          {list.some((b) => b.running) && <AutoRefresh seconds={15} />}
          <ul className="divide-y divide-line text-sm">
            {list.map((b, i) => (
              <li key={b.key} className="space-y-1.5 py-3 first:pt-0">
                <p className="flex justify-between gap-2">
                  <span className="text-muted">{dmhm(new Date(b.at))}</span>
                  <span className="tabular-nums">
                    отправлено {b.sent} из {b.total}
                    {b.read > 0 && ` · прочитали ${b.read}`}
                    {b.failed > 0 && <span className="text-up"> · не ушло {b.failed}</span>}
                  </span>
                </p>
                <p className="line-clamp-2 whitespace-pre-wrap">{b.sample}</p>
                {b.queued > 0 && (
                  <ActionForm action={broadcastControlAction} className="flex flex-wrap items-center gap-2">
                    <input type="hidden" name="key" value={b.key} />
                    <span className="text-muted">{b.running ? `идёт, в очереди ${b.queued}` : `прервана, в очереди ${b.queued}`}</span>
                    {!b.running && (
                      <Submit name="op" value="resume" className="btn-primary min-h-9 px-3 text-xs">
                        Продолжить
                      </Submit>
                    )}
                    <Submit name="op" value="stop" className="btn-danger min-h-9 px-3 text-xs" confirm={`Не отправлять оставшиеся ${b.queued}?`}>
                      Остановить
                    </Submit>
                  </ActionForm>
                )}
                {failures[i].length > 0 && (
                  <details>
                    <summary className="text-up">Кому не ушло</summary>
                    <ul className="mt-1 space-y-1">
                      {failures[i].map((f) => (
                        <li key={f.id}>
                          <Link href={`/clients/${f.id}`} className="text-accent underline">
                            {f.company || f.name || prettyPhone(f.phone)}
                          </Link>
                          {f.error && <span className="text-muted"> · {f.error}</span>}
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2>Кому</h2>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
          {(Object.keys(SEG_LABEL) as (keyof typeof SEG_LABEL)[]).map((k) => (
            <Link
              key={k}
              href={`/clients/broadcast${k || type ? `?${new URLSearchParams(Object.entries({ seg: k, type: type ?? "" }).filter((e) => e[1]))}` : ""}`}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${seg === k ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
            >
              {SEG_LABEL[k]}
            </Link>
          ))}
        </div>
        {seg !== "lapsed" && (
          <form className="flex gap-2">
            {seg && <input type="hidden" name="seg" value={seg} />}
            <select name="type" defaultValue={type ?? ""} aria-label="Тип клиента" className="input">
              <option value="">Все типы</option>
              {Object.entries(CLIENT_TYPES).map(([k, label]) => (
                <option key={k} value={k}>
                  {label}
                </option>
              ))}
            </select>
            <button className="btn">Показать</button>
          </form>
        )}
      </section>

      {recipients.length > MAX_RECIPIENTS ? (
        <p className="card text-warn">Больше {MAX_RECIPIENTS} клиентов — сузьте список типом или поиском в «Клиентах», за один раз уйдёт не больше {MAX_RECIPIENTS}.</p>
      ) : (
        <BroadcastForm key={`${seg}|${type}|${sp.q ?? ""}`} recipients={recipients} />
      )}
    </div>
  );
}
