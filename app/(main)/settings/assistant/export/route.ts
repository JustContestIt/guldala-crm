import { requireOwner } from "@/lib/auth";
import { almatyDay } from "@/lib/format";
import { RUN_FILTERS, runLog, runsCsv } from "@/services/assistant";

// «Выгрузить в Excel»: the journal with the screen's filter (?runs=), every run kept, as a CSV
export async function GET(req: Request) {
  await requireOwner();
  const filter = new URL(req.url).searchParams.get("runs");
  const rows = await runLog({ only: RUN_FILTERS.find((f) => f === filter), limit: 20_000 });
  return new Response(runsCsv(rows), {
    headers: {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="guldala-bot-${almatyDay(new Date())}.csv"`,
    },
  });
}
