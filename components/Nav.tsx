"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

// Bottom bar of spec §5. «Сегодня», «Выдача» and «Клиенты» join at stage 3.
const ITEMS = [
  { href: "/quote", label: "Расчёт", d: "M7 3h10a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Zm1 4h8M8 12h2m4 0h2m-8 4h2m4 0h2" },
  { href: "/orders", label: "Заказы", d: "M9 6h11M9 12h11M9 18h11M4 6h.01M4 12h.01M4 18h.01" },
  { href: "/more", label: "Ещё", d: "M5 12h.01M12 12h.01M19 12h.01" },
];

export function Nav() {
  const path = usePathname();
  return (
    <nav className="fixed inset-x-0 bottom-0 z-10 border-t border-line bg-white pb-[env(safe-area-inset-bottom)]">
      <ul className="mx-auto flex max-w-3xl">
        {ITEMS.map((it) => {
          const active = path.startsWith(it.href);
          return (
            <li key={it.href} className="flex-1">
              <Link
                href={it.href}
                aria-current={active ? "page" : undefined}
                className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium ${active ? "text-accent" : "text-muted"}`}
              >
                <svg viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden="true">
                  <path d={it.d} />
                </svg>
                {it.label}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
