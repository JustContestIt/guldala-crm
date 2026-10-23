// Display formats of spec §15: "12 500 ₸", "06.03", "14:30", all in Asia/Almaty
const TZ = "Asia/Almaty";

// ru-RU groups digits with a no-break space; the ₸ sign is glued with one too
export const tenge = (n: number) => `${new Intl.NumberFormat("ru-RU").format(n)} ₸`;

// Calendar day in Almaty as YYYY-MM-DD, so price periods switch at local midnight
export const almatyDay = (d: Date) => new Intl.DateTimeFormat("en-CA", { timeZone: TZ }).format(d);

// "2027-03-06" → "06.03"
export const dm = (day: string) => `${day.slice(8, 10)}.${day.slice(5, 7)}`;

export const hm = (d: Date) =>
  new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit", timeZone: TZ }).format(d);

// "23.10 18:00"
export const dmhm = (d: Date) => `${dm(almatyDay(d))} ${hm(d)}`;

// Postgres time "14:30:00" → "14:30"
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : "");

export const addDays = (day: string, n: number) => {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Kazakhstan numbers only: +7 / 8 / 7 followed by 10 digits → "+77771006667"; null otherwise
export function normalizePhone(s: string): string | null {
  const m = /^(?:\+?7|8)(\d{10})$/.exec(s.replace(/[\s()-]/g, ""));
  return m ? `+7${m[1]}` : null;
}

// "+77771006667" → "+7 777 100 66 67"
export const prettyPhone = (p: string) => p.replace(/^\+7(\d{3})(\d{3})(\d{2})(\d{2})$/, "+7 $1 $2 $3 $4");
