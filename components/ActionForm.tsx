"use client";

import { createContext, use, useState, useTransition, type ReactNode } from "react";
import type { FormState } from "@/lib/form";

const Pending = createContext(false);

// A form posting to a server action that answers { error } or { ok }. Submitted by hand rather than via
// <form action>: React resets a form after every action, and a refusal would wipe what was typed.
export function ActionForm({
  action,
  children,
  className = "space-y-3",
}: {
  action: (prev: FormState, fd: FormData) => Promise<FormState>;
  children: ReactNode;
  className?: string;
}) {
  const [state, setState] = useState<FormState>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        const form = e.currentTarget;
        const fd = new FormData(form, (e.nativeEvent as SubmitEvent).submitter);
        start(async () => {
          const r = await action(state, fd);
          setState(r ?? null);
          if (r?.ok) {
            form.reset();
            form.closest("dialog")?.close(); // a Sheet's job is done; the page already shows the change
          }
        });
      }}
    >
      <Pending value={pending}>{children}</Pending>
      {state?.error && (
        <p role="alert" className="rounded-lg bg-up-bg px-3 py-2 text-sm text-up">
          {state.error}
        </p>
      )}
      {state?.ok && (
        <p role="status" className="rounded-lg bg-mint px-3 py-2 text-sm text-accent-dark">
          {state.ok}
        </p>
      )}
    </form>
  );
}

// Puts a ready value into a field of the same form (e.g. «5%» → discount amount); saving stays a separate tap
export function Preset({ name, value, children }: { name: string; value: number; children: ReactNode }) {
  return (
    <button
      type="button"
      className="btn min-h-9 text-xs"
      onClick={(e) => {
        const field = e.currentTarget.form?.elements.namedItem(name);
        if (field instanceof HTMLInputElement) field.value = String(value);
      }}
    >
      {children}
    </button>
  );
}

// name/value: one form, several one-tap choices (e.g. «Выдано · наличные» / «Выдано · Kaspi»)
export function Submit({ children, className = "btn-primary", confirm, name, value }: { children: ReactNode; className?: string; confirm?: string; name?: string; value?: string }) {
  const pending = use(Pending);
  return (
    <button
      type="submit"
      name={name}
      value={value}
      disabled={pending}
      className={`btn ${className}`}
      onClick={confirm ? (e) => !window.confirm(confirm) && e.preventDefault() : undefined}
    >
      {pending ? "…" : children}
    </button>
  );
}
