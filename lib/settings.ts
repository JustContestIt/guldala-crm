// seasons.settings (spec §5.8, §6). Every [ДОПУЩЕНИЕ] of the spec lives here, so Tatiana's answer is one edit.
export type SeasonSettings = {
  pack_size: number;
  min_order_stems: number;
  min_order_scope: "total" | "per_color"; // open question 1
  hold_days: number;
  check_threshold_amount: number; // ₸, open question 4
  prepayment_min_pct: number;
  prepayment_max_pct: number;
  prepayment_step: number;
  pickup_hours: string; // "08:00–18:00"
  pickup_hours_peak: string;
  peak_hours_from: string; // YYYY-MM-DD, from this day pickup_hours_peak apply
  ready_status_enabled: boolean;
  issue_on_full_payment_allowed: boolean;
  price_lock_on: "prepaid" | "confirmed"; // open question 2
  client_notifications: "manual" | "auto";
};

export const DEFAULT_SETTINGS: SeasonSettings = {
  pack_size: 30,
  min_order_stems: 120,
  min_order_scope: "total",
  hold_days: 3,
  check_threshold_amount: 100_000,
  prepayment_min_pct: 40,
  prepayment_max_pct: 100,
  prepayment_step: 10,
  pickup_hours: "08:00–18:00",
  pickup_hours_peak: "08:00–23:00",
  peak_hours_from: "",
  ready_status_enabled: false,
  issue_on_full_payment_allowed: true,
  price_lock_on: "prepaid",
  client_notifications: "manual",
};

// "08:00–18:00" → ["08:00", "18:00"]; null if it isn't a range
export function parseHours(s: string): [string, string] | null {
  const m = /^(\d{2}:\d{2})\s*[–-]\s*(\d{2}:\d{2})$/.exec(s.trim());
  return m && m[1] < m[2] ? [m[1], m[2]] : null;
}

export const hoursFor = (s: SeasonSettings, day: string | null) =>
  day && s.peak_hours_from && day >= s.peak_hours_from ? s.pickup_hours_peak : s.pickup_hours;

export const pctOptions = (s: SeasonSettings) => {
  const out: number[] = [];
  for (let p = s.prepayment_min_pct; p <= s.prepayment_max_pct; p += s.prepayment_step) out.push(p);
  return out;
};

export const SEASON_STATUS = { planning: "Планирование", open: "Открыт", closed: "Закрыт" } as const;
