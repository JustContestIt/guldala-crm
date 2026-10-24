import { requireOwner } from "@/lib/auth";
import { almatyDay } from "@/lib/format";
import { currentSeason } from "@/services/catalog";
import { CLIENT_TYPES, clientList, clientsCsv, lapsedClients, SEGMENTS, type ClientType, type Segment } from "@/services/clients";

// «Выгрузить»: the list with the screen's filters (?seg, ?type, ?q) as a CSV for Excel
export async function GET(req: Request) {
  await requireOwner();
  const sp = new URL(req.url).searchParams;
  const seg = sp.get("seg") ?? "";
  const type = sp.get("type") ?? "";
  const season = await currentSeason();
  const rows = await clientList(
    {
      q: sp.get("q") ?? "",
      type: Object.hasOwn(CLIENT_TYPES, type) ? (type as ClientType) : null,
      seg: Object.hasOwn(SEGMENTS, seg) ? (seg as Segment) : null,
      seasonId: season?.id,
    },
    20_000,
  );
  // «брали в прошлом сезоне, в этом нет» is its own query: keep the base rows of those clients
  const lapsed = seg === "lapsed" && season ? new Set((await lapsedClients(season)).rows.map((r) => r.id)) : null;
  return new Response(clientsCsv(lapsed ? rows.filter((r) => lapsed.has(r.id)) : rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="guldala-clients-${almatyDay(new Date())}.csv"`,
    },
  });
}
