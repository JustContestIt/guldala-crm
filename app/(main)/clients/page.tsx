import type { Metadata } from "next";
import Link from "next/link";
import { almatyDay, dm, prettyPhone } from "@/lib/format";
import { currentSeason } from "@/services/catalog";
import { CLIENT_TYPES, clientList, lapsedClients } from "@/services/clients";

export const metadata: Metadata = { title: "Клиенты" };

const who = (r: { company: string | null; name: string; phone: string }) => r.company || r.name || prettyPhone(r.phone);

export default async function ClientsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const lapsed = sp.filter === "lapsed";
  const q = sp.q ?? "";

  return (
    <div className="space-y-4">
      <h1>Клиенты</h1>
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
        {(
          [
            ["", "Все"],
            ["lapsed", "Брали в прошлом сезоне, в этом нет"],
          ] as const
        ).map(([k, label]) => (
          <Link
            key={k}
            href={k ? `/clients?filter=${k}` : "/clients"}
            className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${(k === "lapsed") === lapsed ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
          >
            {label}
          </Link>
        ))}
      </div>
      {lapsed ? <Lapsed /> : <All q={q} />}
    </div>
  );
}

async function All({ q }: { q: string }) {
  const rows = await clientList(q);
  return (
    <>
      <form className="flex gap-2">
        <input name="q" defaultValue={q} type="search" placeholder="Телефон, имя, магазин" aria-label="Поиск" className="input" />
        <button className="btn">Найти</button>
      </form>
      <ul className="card divide-y divide-line p-0">
        {rows.map((r) => (
          <li key={r.id}>
            <Link href={`/clients/${r.id}`} className="block px-4 py-3">
              <span className="font-semibold">{who(r)}</span>
              <span className="block text-sm text-muted">
                {[r.company && r.name, (r.company || r.name) && prettyPhone(r.phone), r.clientType !== "flower_shop" && CLIENT_TYPES[r.clientType]].filter(Boolean).join(" · ")}
              </span>
            </Link>
          </li>
        ))}
        {!rows.length && <li className="px-4 py-6 text-center text-muted">Никого не нашли</li>}
      </ul>
    </>
  );
}

// January calls (spec §5.6): no bulk send, each season_open goes from the client card after Tatiana reads it
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
