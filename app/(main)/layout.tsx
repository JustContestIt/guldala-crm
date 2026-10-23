import { Nav } from "@/components/Nav";
import { requireUser } from "@/lib/auth";

export default async function MainLayout({ children }: { children: React.ReactNode }) {
  await requireUser();
  return (
    <>
      <main className="mx-auto max-w-3xl px-4 pt-4 pb-24">{children}</main>
      <Nav />
    </>
  );
}
