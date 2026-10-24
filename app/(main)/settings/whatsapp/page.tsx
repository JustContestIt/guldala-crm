import type { Metadata } from "next";
import { ActionForm, Submit } from "@/components/ActionForm";
import { BackLink } from "@/components/ui";
import { CHANNEL_STATE, messaging } from "@/integrations/messaging";
import { requireOwner } from "@/lib/auth";
import { dmhm, prettyPhone } from "@/lib/format";
import { channelInfo } from "@/services/messages";
import { connectWhatsappAction } from "../actions";

export const metadata: Metadata = { title: "WhatsApp" };

// Spec §5.8 «WhatsApp (Wazzup)»: channel state, number, last webhook, subscribing the webhooks
export default async function WhatsappPage() {
  await requireOwner();
  const ch = await channelInfo();
  const fake = messaging().name === "fake";
  const tests = process.env.WAZZUP_TEST_PHONES;
  return (
    <div className="space-y-4">
      <BackLink href="/more">Ещё</BackLink>
      <h1>WhatsApp</h1>
      <section className="card space-y-1.5 text-sm">
        <div className="flex justify-between gap-3">
          <span className="text-muted">Канал</span>
          <b className={ch.state === "active" ? "text-accent-dark" : "text-up"}>{ch.state ? (CHANNEL_STATE[ch.state] ?? ch.state) : "неизвестно"}</b>
        </div>
        {ch.phone && (
          <div className="flex justify-between gap-3">
            <span className="text-muted">Номер</span>
            <span>{prettyPhone(ch.phone)}</span>
          </div>
        )}
        <div className="flex justify-between gap-3">
          <span className="text-muted">Статус обновлён</span>
          <span>{ch.stateAt ? dmhm(ch.stateAt) : "—"}</span>
        </div>
        <div className="flex justify-between gap-3">
          <span className="text-muted">Последний вебхук</span>
          <span>{ch.webhookAt ? dmhm(ch.webhookAt) : "ещё не было"}</span>
        </div>
        {fake && <p className="text-warn">Wazzup не подключён (нет WAZZUP_API_TOKEN): сообщения только пишутся в журнал.</p>}
        {tests && <p className="text-warn">Тестовый режим: CRM пишет, принимает и отвечает только номерам {tests}.</p>}
      </section>
      <ActionForm action={connectWhatsappAction} className="card space-y-3">
        <p className="text-sm text-muted">
          Подписывает вебхуки Wazzup на эту CRM (входящие, статусы, состояние канала) и проверяет канал. Повторять можно сколько угодно.
        </p>
        <Submit>Подписать вебхуки и проверить</Submit>
      </ActionForm>
    </div>
  );
}
