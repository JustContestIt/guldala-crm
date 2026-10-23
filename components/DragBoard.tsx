"use client";

import { useRouter } from "next/navigation";
import { useRef, type ReactNode } from "react";
import { statusAction } from "@/app/(main)/actions";
import type { Status } from "@/lib/calc";
import { canMove } from "@/lib/status";

// Spec §5.4, desktop only: dropping a card equals the button of that transition — the same server action,
// or the same form on the order card. Columns a card can't go to are not lit. Cards: [data-card][data-status], columns: [data-col].
export function DragBoard({ ready, children }: { ready: boolean; children: ReactNode }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);
  const drag = useRef<{ id: string; status: Status } | null>(null);
  const allowed = (to: Status) => {
    const c = drag.current;
    return !!c && to !== "expired" && (to !== "ready" || ready) && canMove(c.status, to); // expired is the system's move only
  };
  const colOf = (e: React.DragEvent) => (e.target as HTMLElement).closest<HTMLElement>("[data-col]")?.dataset.col as Status | undefined;
  const cols = () => box.current?.querySelectorAll<HTMLElement>("[data-col]") ?? [];
  const end = () => {
    drag.current = null;
    cols().forEach((el) => delete el.dataset.drop);
  };

  return (
    <div
      ref={box}
      onDragStart={(e) => {
        const el = (e.target as HTMLElement).closest<HTMLElement>("[data-card]");
        if (!el || !matchMedia("(min-width: 1024px)").matches) return e.preventDefault();
        drag.current = { id: el.dataset.card!, status: el.dataset.status as Status };
        e.dataTransfer.effectAllowed = "move";
        cols().forEach((c) => allowed(c.dataset.col as Status) && (c.dataset.drop = ""));
      }}
      onDragOver={(e) => {
        const to = colOf(e);
        if (to && allowed(to)) e.preventDefault();
      }}
      onDragEnd={end}
      onDrop={async (e) => {
        e.preventDefault();
        const to = colOf(e);
        const c = drag.current;
        const ok = to && allowed(to);
        end();
        if (!c || !to || !ok) return;
        if (to === "confirmed" || to === "ready") {
          const fd = new FormData();
          fd.set("id", c.id);
          fd.set("op", to === "ready" ? "ready" : c.status === "expired" ? "resume" : "confirm");
          const r = await statusAction(null, fd);
          if (r?.error) alert(r.error); // nothing moved: the card stays where it was
        } else router.push(`/orders/${c.id}?do=${{ prepaid: "pay", issued: "issue", cancelled: "cancel" }[to as string]}#do`);
      }}
    >
      {children}
    </div>
  );
}
