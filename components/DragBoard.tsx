"use client";

import { useRouter } from "next/navigation";
import { useEffect, useRef, type ReactNode } from "react";
import { cancelAction, invoiceAction, issueAction, paymentAction, statusAction } from "@/app/(main)/actions";
import type { FormState } from "@/lib/form";
import { tenge } from "@/lib/format";
import { canMove } from "@/lib/status";
import type { Status } from "@/lib/calc";

// Spec §5.4: drag a card to another status — the phone first. Touch: hold ~0.3 s, then drag (a quick swipe still
// scrolls the strip, a tap still opens the order). Mouse: drag right away. A drop does what the card's button does,
// through the same server actions. Markup contract: columns [data-col], cards [data-card] with data-status,
// data-number, data-due, data-balance, data-invoice, data-invoice-amount.
const HOLD_MS = 300;
const SLOP = 8; // px a finger may wander while holding before it counts as a scroll

type Drag = { el: HTMLElement; id: string; status: Status; ghost: HTMLElement; dx: number; dy: number; x: number; y: number; over: HTMLElement | null };

export function DragBoard({ ready, children }: { ready: boolean; children: ReactNode }) {
  const router = useRouter();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const root = box.current!;
    let drag: Drag | null = null;
    let pending: { el: HTMLElement; x: number; y: number; timer?: number; mouse: boolean } | null = null;
    let swallowClick = false;
    let raf = 0;

    const cols = () => [...root.querySelectorAll<HTMLElement>("[data-col]")];
    // expired is the system's move only; ready only when the season uses it
    const allowed = (from: Status, to: Status) => to !== from && to !== "expired" && (to !== "ready" || ready) && canMove(from, to);

    const start = (el: HTMLElement, x: number, y: number) => {
      const r = el.getBoundingClientRect();
      const ghost = el.cloneNode(true) as HTMLElement;
      Object.assign(ghost.style, {
        position: "fixed", left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, margin: "0", zIndex: "60",
        pointerEvents: "none", transform: "rotate(2deg) scale(1.03)", boxShadow: "0 12px 32px rgb(0 0 0 / 0.18)", opacity: "0.96",
      });
      document.body.appendChild(ghost);
      el.style.opacity = "0.35";
      const status = el.dataset.status as Status;
      drag = { el, id: el.dataset.card!, status, ghost, dx: x - r.left, dy: y - r.top, x, y, over: null };
      for (const c of cols()) if (allowed(status, c.dataset.col as Status)) c.dataset.drop = "";
      document.body.style.userSelect = "none";
      navigator.vibrate?.(15);
      raf = requestAnimationFrame(tick);
    };

    // follow the finger; scroll the page when the finger nears the top or the bottom bar
    const tick = () => {
      if (!drag) return;
      const edge = 90;
      const still = drag.over?.dataset.col === "cancelled"; // the cancel zone is fixed: don't scroll the page away under it
      if (!still && drag.y < edge) window.scrollBy(0, -12);
      else if (!still && drag.y > window.innerHeight - edge - 56) window.scrollBy(0, 12);
      move(drag.x, drag.y);
      raf = requestAnimationFrame(tick);
    };

    const move = (x: number, y: number) => {
      if (!drag) return;
      drag.x = x;
      drag.y = y;
      drag.ghost.style.left = `${x - drag.dx}px`;
      drag.ghost.style.top = `${y - drag.dy}px`;
      const over = (document.elementFromPoint(x, y)?.closest<HTMLElement>("[data-col]") ?? null) as HTMLElement | null;
      const target = over && "drop" in over.dataset ? over : null;
      if (target !== drag.over) {
        if (drag.over) delete drag.over.dataset.over;
        if (target) target.dataset.over = "";
        drag.over = target;
      }
    };

    const finish = (drop: boolean) => {
      cancelAnimationFrame(raf);
      if (pending?.timer) clearTimeout(pending.timer);
      pending = null;
      if (!drag) return;
      const d = drag;
      drag = null;
      d.ghost.remove();
      d.el.style.opacity = "";
      document.body.style.userSelect = "";
      for (const c of cols()) {
        delete c.dataset.drop;
        delete c.dataset.over;
      }
      swallowClick = true; // the click that ends a drag must not open the order
      setTimeout(() => (swallowClick = false), 400);
      if (drop && d.over) void act(d.el, d.id, d.status, d.over.dataset.col as Status);
    };

    const run = async (action: (s: FormState, fd: FormData) => Promise<FormState>, fields: Record<string, string>) => {
      const fd = new FormData();
      for (const [k, v] of Object.entries(fields)) fd.set(k, v);
      const r = await action(null, fd);
      if (r?.error) alert(r.error); // nothing moved: the card stays where it was
      router.refresh();
    };

    // the drop = the button of that transition (same actions, same checks, same journal)
    const act = async (el: HTMLElement, id: string, from: Status, to: Status) => {
      const n = el.dataset.number ?? "";
      if (to === "confirmed") return run(statusAction, { id, op: from === "expired" ? "resume" : "confirm" });
      if (to === "ready") return run(statusAction, { id, op: "ready" });
      if (to === "prepaid") {
        const inv = el.dataset.invoice;
        if (inv) return confirm(`${n}: счёт Kaspi ${tenge(Number(el.dataset.invoiceAmount))} оплачен?`) && run(invoiceAction, { paymentId: inv });
        const due = el.dataset.due ?? "0";
        return confirm(`${n}: предоплата ${tenge(Number(due))} по Kaspi получена?`) && run(paymentAction, { id, amount: due, method: "kaspi_invoice" });
      }
      if (to === "issued") {
        if (Number(el.dataset.balance) > 0) return router.push(`/orders/${id}`); // cash or Kaspi for the balance — chosen there
        return confirm(`Выдать ${n} целиком?`) && run(issueAction, { id });
      }
      if (to === "cancelled") {
        const reason = prompt(`${n}: причина отмены`)?.trim();
        return reason ? run(cancelAction, { id, reason }) : undefined;
      }
    };

    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || drag) return;
      const t = e.target as HTMLElement;
      if (t.closest("button, input, select, textarea")) return; // the card's own buttons stay buttons
      const el = t.closest<HTMLElement>("[data-card]");
      if (!el || !root.contains(el)) return;
      const mouse = e.pointerType === "mouse";
      pending = { el, x: e.clientX, y: e.clientY, mouse };
      if (!mouse) pending.timer = window.setTimeout(() => pending && start(pending.el, pending.x, pending.y), HOLD_MS);
    };

    const onMove = (e: PointerEvent) => {
      if (drag) return move(e.clientX, e.clientY);
      if (!pending) return;
      const far = Math.hypot(e.clientX - pending.x, e.clientY - pending.y) > (pending.mouse ? 5 : SLOP);
      if (!far) return;
      if (pending.mouse) start(pending.el, e.clientX, e.clientY);
      else finish(false); // the finger moved before the hold: it's a scroll
    };

    // while dragging the page must not scroll under the finger; non-passive so preventDefault works
    const onTouchMove = (e: TouchEvent) => {
      if (drag) e.preventDefault();
    };
    const onUp = () => finish(true);
    const onCancel = () => finish(false);
    const onClick = (e: MouseEvent) => {
      if (swallowClick) {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    const noNative = (e: Event) => e.preventDefault(); // the browser's own link drag would cancel ours
    const onMenu = (e: Event) => {
      if (pending || drag) e.preventDefault(); // a long press on a link must not open the browser menu
    };

    root.addEventListener("pointerdown", onDown);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
    root.addEventListener("click", onClick, true);
    root.addEventListener("contextmenu", onMenu);
    root.addEventListener("dragstart", noNative);
    return () => {
      finish(false);
      root.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onCancel);
      window.removeEventListener("touchmove", onTouchMove);
      root.removeEventListener("click", onClick, true);
      root.removeEventListener("contextmenu", onMenu);
      root.removeEventListener("dragstart", noNative);
    };
  }, [ready, router]);

  return <div ref={box}>{children}</div>;
}
