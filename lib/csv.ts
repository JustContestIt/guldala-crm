// A table for Excel: semicolons (the Russian Excel's separator), a BOM so Cyrillic opens right, quotes only where a cell needs them
export function toCsv(head: string[], rows: (string | number)[][]) {
  const cell = (v: string | number) => (/[";\r\n]/.test(String(v)) ? `"${String(v).replace(/"/g, '""')}"` : String(v));
  return "\uFEFF" + [head, ...rows].map((r) => r.map(cell).join(";")).join("\r\n");
}
