import type { Metadata } from "next";
import Link from "next/link";
import { ActionForm, Submit } from "@/components/ActionForm";
import { RunDetails } from "@/components/RunDetails";
import { BackLink, Field } from "@/components/ui";
import { EFFORTS, listModels, PRICES, type Effort } from "@/integrations/openai";
import { requireOwner } from "@/lib/auth";
import { almatyDay, dm, dmhm, prettyPhone } from "@/lib/format";
import { assistantSettings, promptFile, RUN_FILTERS, runLog, type RunFilter } from "@/services/assistant";
import { assistantAction } from "../actions";

export const metadata: Metadata = { title: "Ассистент" };

const EFFORT_LABEL: Record<Effort, string> = {
  "": "по умолчанию модели",
  none: "без размышления (none)",
  minimal: "минимальное (minimal)",
  low: "низкое (low)",
  medium: "среднее (medium)",
  high: "высокое (high)",
  xhigh: "очень высокое (xhigh)",
  max: "максимальное (max)",
};

const FILTER: Record<RunFilter, string> = { error: "Ошибки", silent: "Промолчал", handoff: "Передал Татьяне" };

// Spec §5.8 «Ассистент»: mode, the OpenAI model from the account's list, reasoning effort; the run journal; the prompt files to read
export default async function AssistantPage({ searchParams }: { searchParams: Promise<{ runs?: string }> }) {
  await requireOwner();
  const { runs: filter } = await searchParams;
  const only = RUN_FILTERS.find((f) => f === filter);
  const [a, runs] = await Promise.all([assistantSettings(), runLog({ only })]);
  const key = !!process.env.OPENAI_API_KEY;
  let models: { id: string; shutdown: string | null }[] = [];
  let listError = "";
  if (key)
    try {
      models = await listModels(almatyDay(new Date()));
    } catch (e) {
      listError = e instanceof Error ? e.message : String(e);
    }
  if (!models.some((m) => m.id === a.model)) models.unshift({ id: a.model, shutdown: null });
  const tests = process.env.WAZZUP_TEST_PHONES;

  return (
    <div className="space-y-4">
      <BackLink href="/more">Ещё</BackLink>
      <h1>Ассистент</h1>
      <section className="card space-y-2 text-sm">
        <p>Бот отвечает на входящие в WhatsApp по правилам и базе знаний ниже и оформляет заказ, как сайт. В чате, где Татьяна ответила сама, бот молчит — включить его снова можно в карточке клиента.</p>
        {!key && <p className="text-up">Нет OPENAI_API_KEY — ассистент молчит.</p>}
        {listError && <p className="text-warn">Список моделей OpenAI не загрузился: {listError}</p>}
        {tests && <p className="text-warn">Тестовый режим: бот отвечает только номерам {tests}.</p>}
      </section>
      <ActionForm action={assistantAction} className="card space-y-3">
        <Field label="Режим">
          <select name="mode" defaultValue={a.mode} className="input">
            <option value="off">выключен</option>
            <option value="draft">черновики — отправляет Татьяна</option>
            <option value="auto">отвечает сам</option>
          </select>
        </Field>
        <Field label="Модель OpenAI">
          <select name="model" defaultValue={a.model} className="input">
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.id}
                {PRICES[m.id] ? ` · $${PRICES[m.id]}` : ""}
                {m.shutdown ? ` · отключат ${dm(m.shutdown)}.${m.shutdown.slice(0, 4)}` : ""}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-muted">
          Цена — $ за 1 млн токенов, вход / выход (OpenAI, 24.10.2026). Для переписки хватает дешёвой gpt-6-luna. Модель с датой отключения раньше 8 марта не берите: бот замолчит посреди сезона (gpt-4o и gpt-4.1 отключат 14.01.2027).
        </p>
        <Field label="Размышление">
          <select name="effort" defaultValue={a.effort} className="input">
            {EFFORTS.map((e) => (
              <option key={e} value={e}>
                {EFFORT_LABEL[e]}
              </option>
            ))}
          </select>
        </Field>
        <p className="text-xs text-muted">
          Больше размышления — точнее, но дольше и дороже. gpt-4o и gpt-4.1 не размышляют: им — «по умолчанию модели». При сохранении CRM задаёт модели короткий вопрос и не сохранит пару, которую OpenAI не принимает.
        </p>
        <Submit>Сохранить</Submit>
      </ActionForm>
      <section className="card space-y-3">
        <h2>Журнал</h2>
        <p className="text-xs text-muted">
          Последние 50 запусков бота: что он вызвал, что ответила CRM, ход мысли модели (по-английски, кратко) и ответ. «Правила» — отпечаток базы знаний, ограничений и условий сезона: сменился — бот отвечал уже по другим правилам.
        </p>
        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 no-scrollbar">
          {([["", "Все"], ...Object.entries(FILTER)] as [string, string][]).map(([k, label]) => (
            <Link
              key={k}
              href={`/settings/assistant${k ? `?runs=${k}` : ""}`}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-sm ${(only ?? "") === k ? "border-accent bg-accent text-white" : "border-line bg-white"}`}
            >
              {label}
            </Link>
          ))}
        </div>
        <ul className="space-y-2">
          {runs.map((r) => (
            <li key={r.run.id}>
              <RunDetails run={r.run} title={`${dmhm(r.run.createdAt)} · ${r.company || r.name || prettyPhone(r.phone)} · `}>
                <Link href={`/clients/${r.clientId}#chat`} className="text-accent underline">
                  Переписка
                </Link>
              </RunDetails>
            </li>
          ))}
        </ul>
        {!runs.length && <p className="text-sm text-muted">Запусков нет</p>}
      </section>
      <details className="card">
        <summary className="font-semibold">Правила — assistant/restrictions.md</summary>
        <pre className="mt-3 text-sm whitespace-pre-wrap">{promptFile("restrictions.md")}</pre>
      </details>
      <details className="card">
        <summary className="font-semibold">База знаний — assistant/knowledge.md</summary>
        <pre className="mt-3 text-sm whitespace-pre-wrap">{promptFile("knowledge.md")}</pre>
      </details>
    </div>
  );
}
