"use client";

import { useState } from "react";

// − N + for pack counts inside a plain form: taps instead of the keyboard; the number is still typeable
export function Stepper({ name, defaultValue = 0, min = 0, max, label }: { name: string; defaultValue?: number; min?: number; max?: number; label: string }) {
  const [n, setN] = useState(defaultValue);
  const set = (v: number) => setN(Math.max(min, max === undefined ? v : Math.min(max, v)));
  return (
    <div className="flex items-center rounded-xl border border-line bg-white">
      <button type="button" onClick={() => set(n - 1)} disabled={n <= min} aria-label={`${label}: меньше`} className="grid size-11 shrink-0 place-items-center text-lg disabled:opacity-30">
        −
      </button>
      <input name={name} value={n} onChange={(e) => set(Number(e.target.value.replace(/\D/g, "")) || 0)} inputMode="numeric" aria-label={label} className="w-full min-w-0 bg-transparent text-center font-semibold tabular-nums outline-none" />
      <button type="button" onClick={() => set(n + 1)} disabled={max !== undefined && n >= max} aria-label={`${label}: больше`} className="grid size-11 shrink-0 place-items-center text-lg disabled:opacity-30">
        +
      </button>
    </div>
  );
}
