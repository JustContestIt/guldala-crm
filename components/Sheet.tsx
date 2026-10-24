"use client";

import { useRef, useState, type ReactNode } from "react";

// A button that opens its form in a native <dialog>: a bottom sheet on the phone, a centred box on a wide screen.
// ActionForm closes the dialog once its action succeeds.
export function Sheet({ label, title = label, className = "", children }: { label: string; title?: string; className?: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  const [round, setRound] = useState(0);
  return (
    <>
      <button type="button" className={`btn ${className}`} onClick={() => ref.current?.showModal()}>
        {label}
      </button>
      <dialog
        ref={ref}
        aria-label={title}
        // a tap on the backdrop lands on the <dialog> itself, a tap on the content lands inside it
        onClick={(e) => e.target === e.currentTarget && e.currentTarget.close()}
        // every close remounts the forms: the next open starts clean, without the last «Сохранено» or error
        onClose={() => setRound((r) => r + 1)}
        className="m-0 mt-auto max-h-[90svh] w-full max-w-none overflow-y-auto rounded-t-2xl bg-white text-ink backdrop:bg-ink/40 sm:m-auto sm:max-w-lg sm:rounded-2xl"
      >
        <div key={round} className="space-y-3 p-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          <div className="flex items-center justify-between gap-2">
            <h2>{title}</h2>
            <button type="button" aria-label="Закрыть" className="btn min-h-9 border-0 px-2 text-lg text-muted" onClick={() => ref.current?.close()}>
              ✕
            </button>
          </div>
          {children}
        </div>
      </dialog>
    </>
  );
}
