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
          if (r?.ok) form.reset();
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
