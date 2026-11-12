// E-mail from the zakaz@tulpan.org mailbox on the shared hosting (review 09.11.2026, С10, К23).
// No SMTP_HOST = test mode: the letter is logged, not sent.
import { createTransport } from "nodemailer";

export type Letter = { to: string; subject: string; text: string; attachments?: { filename: string; content: Buffer }[] };

// While MAIL_TEST_TO is set ("a@x.kz,b@y.kz"), nobody else gets mail: the same guard as WAZZUP_TEST_PHONES
const testTo = () =>
  (process.env.MAIL_TEST_TO ?? "")
    .split(",")
    .map((s) => s.trim().toLowerCase())
    .filter(Boolean);

export async function sendMail(l: Letter): Promise<{ provider: "smtp" | "fake" }> {
  const only = testTo();
  if (only.length && !only.includes(l.to.toLowerCase())) throw new Error("пропущено, не тестовый адрес (MAIL_TEST_TO)");
  const host = process.env.SMTP_HOST;
  if (!host) {
    console.log(`[mail] → ${l.to}: ${l.subject}${l.attachments?.length ? ` + ${l.attachments.map((a) => a.filename).join(", ")}` : ""} (тестовый режим, SMTP_HOST пуст)`);
    return { provider: "fake" };
  }
  const port = Number(process.env.SMTP_PORT || 465);
  const user = process.env.SMTP_USER ?? "";
  await createTransport({
    host,
    port,
    secure: port === 465, // 465: TLS from the first byte; 587: STARTTLS
    auth: { user, pass: process.env.SMTP_PASSWORD ?? "" },
    connectionTimeout: 15_000,
    greetingTimeout: 15_000,
    socketTimeout: 30_000,
  }).sendMail({ from: { name: "Guldala Tulpan", address: process.env.MAIL_FROM || user }, to: l.to, subject: l.subject, text: l.text, attachments: l.attachments });
  return { provider: "smtp" };
}
