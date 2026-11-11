"use client";

import { useEffect, useState } from "react";

// A message that outlives the card it came from: after a board or «Выдача» action the card leaves the list,
// and its form with it (review 09.11.2026, К22). Any client code shows one with toast("…").
export const toast = (text: string) => window.dispatchEvent(new CustomEvent("toast", { detail: text }));

export function Toaster() {
  const [text, setText] = useState("");
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const show = (e: Event) => {
      setText((e as CustomEvent<string>).detail);
      clearTimeout(t);
      t = setTimeout(() => setText(""), 4000);
    };
    window.addEventListener("toast", show);
    return () => (window.removeEventListener("toast", show), clearTimeout(t));
  }, []);
  return (
    <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-4 bottom-20 z-50 mx-auto max-w-md">
      {text && <p className="rounded-xl bg-ink px-4 py-3 text-center text-sm font-semibold text-white shadow-lg">{text}</p>}
    </div>
  );
}
