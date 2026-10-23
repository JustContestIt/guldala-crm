"use client";

import { useState } from "react";
import { prefillLinkAction, sendAction } from "@/app/(main)/actions";
import { ActionForm, Submit } from "./ActionForm";

type Template = { key: string; label: string; text: string };

// Spec §3.5: every action ends in a ready WhatsApp text — preview, edit, then send or copy.
// orderLink adds «Ссылка для заказа»: the site's order form with this phone's contacts filled in (spec §14)
export function Composer({ templates, phone, orderId, initial, orderLink }: { templates: Template[]; phone?: string; orderId?: string; initial?: string; orderLink?: boolean }) {
  const [key, setKey] = useState(templates.find((t) => t.key === initial)?.key ?? templates[0].key);
  const [text, setText] = useState(templates.find((t) => t.key === key)!.text);
  const [copied, setCopied] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);

  const pick = (k: string) => {
    setKey(k);
    setText(templates.find((t) => t.key === k)!.text);
    setCopied(false);
  };

  return (
    <ActionForm action={sendAction}>
      {templates.length > 1 && (
        <div className="flex flex-wrap gap-2" role="group" aria-label="Шаблон">
          {templates.map((t) => (
            <button
              key={t.key}
              type="button"
              onClick={() => pick(t.key)}
              aria-pressed={t.key === key}
              className={`btn min-h-9 px-3 text-xs ${t.key === key ? "border-accent bg-mint text-accent-dark" : ""}`}
            >
              {t.label}
            </button>
          ))}
        </div>
      )}
      <input type="hidden" name="templateKey" value={key} />
      {orderId && <input type="hidden" name="orderId" value={orderId} />}
      <div className="flex items-end justify-between gap-2">
        <span className="text-xs text-muted">Текст ответа</span>
        <button
          type="button"
          className="btn min-h-8 px-3 text-xs"
          onClick={async (e) => {
            const form = e.currentTarget.form; // currentTarget is gone after the await
            try {
              await navigator.clipboard.writeText(text);
            } catch {
              // no clipboard API outside https (a phone on the LAN in dev): select the text the old way
              (form?.elements.namedItem("text") as HTMLTextAreaElement).select();
              document.execCommand("copy");
            }
            setCopied(true);
          }}
        >
          {copied ? "Скопировано ✓" : "Скопировать"}
        </button>
      </div>
      <textarea
        name="text"
        aria-label="Текст сообщения"
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(12, Math.max(text.split("\n").length + 1, Math.ceil(text.length / 35)))} // one long paragraph (season_open) gets room too
        className="input font-mono text-sm"
      />
      {phone ? (
        <input type="hidden" name="phone" value={phone} />
      ) : (
        <input name="phone" type="tel" inputMode="tel" aria-label="Телефон клиента" placeholder="Телефон клиента, +7…" className="input" />
      )}
      {linkError && <p className="text-sm text-up">{linkError}</p>}
      {/* two actions at most, side by side on a phone; copying lives by the text */}
      <div className={orderLink ? "grid grid-cols-2 gap-2" : "grid"}>
        <Submit>{orderLink ? "Отправить" : "Отправить в WhatsApp"}</Submit>
        {orderLink && (
          <button
            type="button"
            className="btn"
            onClick={async (e) => {
              const r = await prefillLinkAction((e.currentTarget.form?.elements.namedItem("phone") as HTMLInputElement).value);
              setLinkError(r.ok ? null : r.error);
              if (r.ok) setText((t) => `${t.trimEnd()}\n\nОформить заказ на сайте: ${r.url}`);
            }}
          >
            Ссылка для заказа
          </button>
        )}
      </div>
    </ActionForm>
  );
}
