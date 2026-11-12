// The order confirmation as a PDF (review 12.11.2026, П3): the letter's own text, so the two never differ.
// Attached to the letter and downloadable from the order card, to forward in WhatsApp.
// Noto Sans has Cyrillic, the Kazakh letters and ₸ (assets/fonts, SIL OFL); next.config traces it into the image
import { join } from "node:path";
import PDFDocument from "pdfkit";

const FONTS = join(process.cwd(), "assets/fonts");
const REGULAR = join(FONTS, "NotoSans-Regular.ttf");
const BOLD = join(FONTS, "NotoSans-Bold.ttf");

export function letterPdf(title: string, text: string): Promise<Buffer> {
  // `font` here keeps pdfkit off its built-in Helvetica, which has no Cyrillic and reads files the image doesn't have
  const doc = new PDFDocument({ size: "A4", margin: 56, font: REGULAR, info: { Title: title, Author: "Guldala Tulpan" } });
  const chunks: Buffer[] = [];
  const done = new Promise<Buffer>((resolve, reject) => {
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  doc.font(BOLD).fontSize(18).text("Guldala Tulpan");
  doc.fontSize(13).text(title).moveDown();
  doc.font(REGULAR).fontSize(11);
  for (const line of text.split("\n")) {
    if (line) doc.text(line, { lineGap: 2 });
    else doc.moveDown(0.6);
  }
  doc.end();
  return done;
}
