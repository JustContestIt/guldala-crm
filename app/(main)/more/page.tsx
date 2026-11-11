import type { Metadata } from "next";
import Link from "next/link";
import { logout } from "@/app/login/actions";
import { requireUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Настройки" };

export default async function MorePage() {
  const user = await requireUser();
  return (
    <div className="space-y-4">
      <h1>Настройки</h1>
      <ul className="card divide-y divide-line p-0">
        {user.role === "owner" && (
          <>
            <li>
              <Link href="/settings/products" className="block px-4 py-3 font-medium">
                Склад · товары и остатки
              </Link>
            </li>
            <li>
              <Link href="/settings/prices" className="block px-4 py-3 font-medium">
                Сетка цен
              </Link>
            </li>
            <li>
              <Link href="/settings" className="block px-4 py-3 font-medium">
                Сезоны
              </Link>
            </li>
            <li>
              <Link href="/settings/whatsapp" className="block px-4 py-3 font-medium">
                WhatsApp
              </Link>
            </li>
            <li>
              <Link href="/settings/assistant" className="block px-4 py-3 font-medium">
                Ассистент
              </Link>
            </li>
          </>
        )}
      </ul>
      <form action={logout} className="flex items-center justify-between">
        <span className="text-sm text-muted">{user.name}</span>
        <button className="btn">Выйти</button>
      </form>
    </div>
  );
}
