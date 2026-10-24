import type { Metadata } from "next";
import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { almatyDay, dm, prettyPhone, tenge } from "@/lib/format";
import { currentSeason } from "@/services/catalog";
import { CLIENT_TYPES, clientList, lapsedClients, SEGMENTS, type ClientType, type Segment } from "@/services/clients";

export const metadata: Metadata = { title: "Клиенты" };

const who = (r: { company: string | null; name: string; phone: string }) => r.company || r.name || prettyPhone(r.phone);
const plural = (n: number) => (n % 10 === 1 && n % 100 !== 11 ? "заказ" : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? "заказа" : "заказов");

// The client base: filters live in the URL, so «Выгрузить» and «Рассылка» take the same list
export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const user = await requireUser();
  const sp = await searchParams;
  const seg = sp.seg === "lapsed" || Object.hasOwn(SEGMENTS, sp.seg ?? "") ? (sp.seg as Segment | "lapsed") : null;
  const type = Object.hasOwn(CLIENT_TYPES, sp.type ?? "") ? (sp.type as ClientType) : null; // URL input: own keys only
  const q = sp.q ?? "";
  const qs = new URLSearchParams(Object.entries({ seg, type, q }).filter((e): e is [string, string] => !!e[1])).toString();
  const chips: [string, string][] = [["", "Все"], ["season", SEGMENTS.season], ["lapsed", "Брали в прошлом сезоне, в этом нет"], ["none", SEGMENTS.none]];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-2">
        <h1>Клиенты</h1>
        {user.role === "owner" && (
          <Link href="/clients/new" className="btn btn-primary">
            + Клиент
          </Link>
        )}
      </div>
      {user.role === "owner" && (
        <div className="grid grid-cols-3 gap-2">
          <Link href={`/clients/broadcast${qs ? `?${qs}` : ""}`} className="btn px-2">
            Рассылка
          </Link>
          <Link href="/clients/import" className="btn px-2">
            Импорт
          </Link>
          <a href={`/clients/export${qs ? `?${qs}` : ""}`} className="btn px-2" download>
            Выгрузить
          </a>
        </div>
      )}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
        {chips.map(([k, label]) => (
          <Link
            key={k}
            href={`/clients${k || type ? `?${new URLSearchParams(Object.entries({ seg: k, type: type ?? "" }).filter((e) => e[1]))}` : ""}`}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${(seg ?? "") === k ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {seg === "lapsed" ? <Lapsed /> : <All q={q} type={type} seg={seg} />}
    </div>
  );
}

async function All({ q, type, seg }: { q: string; type: ClientType | null; seg: Segment | null }) {
  const season = await currentSeason();
  const rows = await clientList({ q, type, seg, seasonId: season?.id });
  return (
    <>
      <form className="grid grid-cols-[1fr_auto] gap-2">
        {seg && <input type="hidden" name="seg" value={seg} />}
        <input name="q" defaultValue={q} type="search" placeholder="Телефон, имя, магазин" aria-label="Поиск" className="input" />
        <button className="btn">Найти</button>
        <select name="type" defaultValue={type ?? ""} aria-label="Тип клиента" className="input col-span-2">
          <option value="">Все типы</option>
          {Object.entries(CLIENT_TYPES).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </select>
      </form>
      <p className="text-sm text-muted">
        {rows.length === 200 ? "Первые 200 — уточните поиск" : `Найдено: ${rows.length}`}
      </p>
      <ul className="card divide-y divide-line p-0">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/clients/${r.id}`} className="block px-4 py-3">
              <span className="flex items-baseline justify-between gap-2">
                <span className="font-semibold">{who(r)}</span>
                {r.orders > 0 && <span className="shrink-0 text-sm tabular-nums">{tenge(r.spent)}</span>}
              </span>
              <span className="block text-sm text-muted">
                {[
                  r.company && r.name,
                  (r.company || r.name) && prettyPhone(r.phone),
                  r.clientType !== "flower_shop" && CLIENT_TYPES[r.clientType],
                  r.orders > 0 ? `${r.orders} ${plural(r.orders)}, последний ${dm(almatyDay(new Date(r.lastOrderAt!)))}` : "без заказов",
                ]
                  .filter(Boolean)
                  .join(" · ")}
              </span>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-6 text-center text-muted">Никого не нашли</li>}
      </ul>
    </>
  );
}

// January calls (spec §5.6): each season_open goes from the client card after Tatiana reads it; «Рассылка» sends them all
async function Lapsed() {
  const season = await currentSeason();
  if (!season) return <p className="card">Сезона нет.</p>;
  const { prev, rows } = await lapsedClients(season);
  if (!prev) return <p className="card text-muted">Прошлого сезона в CRM нет — сравнивать не с чем.</p>;
  return (
    <>
      <p className="text-sm text-muted">
        Брали в «{prev.name}», в «{season.name}» не заказывали: {rows.length}
      </p>
      <ul className="card divide-y divide-line p-0">
        {rows.map((r) => (
          <li key={r.id} className="flex items-center gap-3 px-4 py-3">
            <Link href={`/clients/${r.id}`} className="min-w-0 flex-1">
              <span className="font-semibold">{who(r)}</span>
              <span className="block text-sm text-muted">{r.took}</span>
              {r.writtenAt && <span className="block text-sm text-accent">написали {dm(almatyDay(new Date(r.writtenAt)))}</span>}
            </Link>
            <Link href={`/clients/${r.id}?msg=season_open#msg`} className="btn btn-primary min-h-9 shrink-0 text-xs">
              Написать
            </Link>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-6 text-center text-muted">Все прошлогодние клиенты уже заказали</li>}
      </ul>
    </>
  );
}
