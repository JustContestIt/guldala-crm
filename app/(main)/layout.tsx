import { Nav } from "@/components/Nav";
import { requireUser } from "@/lib/auth";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      {/* the orders board (data-wide) takes the whole width on a desktop */}
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-24 lg:has-[[data-wide]]:max-w-none">{children}</main>
      <Nav />
    </>
  );
}
