import type { assistantRuns } from "@/db/schema";
import { dmhm } from "@/lib/format";

const OUTCOME = { sent: "ответил", draft: "написал черновик", silent: "промолчал", error: "ошибка" } as const;
const MODE: Record<string, string> = { draft: "черновики", auto: "отвечает сам" };
const n = (x: number) => new Intl.NumberFormat("ru-RU").format(x);
const sec = (ms: number) => `${(ms / 1000).toFixed(1).replace(".", ",")} с`;

// One assistant run (spec §19 «Журнал»): the outcome on top; inside, each model step — its reasoning, the tools with arguments and answers, the text
export function RunDetails({ run, title = "", children }: { run: typeof assistantRuns.$inferSelect; title?: string; children?: React.ReactNode }) {
  const t = run.steps.reduce((a, s) => ({ in: a.in + (s.usage?.in ?? 0), cached: a.cached + (s.usage?.cached ?? 0), out: a.out + (s.usage?.out ?? 0) }), { in: 0, cached: 0, out: 0 });
  return (
    <details className="text-xs">
      <summary className={`cursor-pointer ${run.outcome === "error" ? "text-up" : "text-muted"}`}>
        {title}Бот {OUTCOME[run.outcome]}
        {run.reason && `: ${run.reason}`} · {sec(run.ms)}
      </summary>
      <div className="mt-2 space-y-2 rounded-xl border border-line bg-white p-3">
        {children}
        <p className="text-muted">
          {dmhm(run.createdAt)} · {MODE[run.mode] ?? run.mode} · {run.model}
          {run.effort && `/${run.effort}`} · правила {run.rules}
          {t.in > 0 && ` · токены ${n(t.in)} (из кэша ${n(t.cached)}) / ${n(t.out)}`}
        </p>
        {run.steps.map((s, i) => (
          <div key={i} className="space-y-1 border-t border-line pt-2">
            <p className="font-semibold">
              Шаг {i + 1} · {sec(s.ms)}
            </p>
            {s.reasoning && <p className="whitespace-pre-wrap text-muted italic">{s.reasoning}</p>}
            {s.calls.map((c, j) => (
              <div key={j} className="font-mono break-all">
                <p>
                  {c.name}({c.args === "{}" ? "" : c.args})
                </p>
                <p className="text-muted">→ {JSON.stringify(c.result)}</p>
                {c.crash && <p className="text-up">{c.crash}</p>}
              </div>
            ))}
            {s.text && <p className="whitespace-pre-wrap">{s.text}</p>}
          </div>
        ))}
      </div>
    </details>
  );
}
