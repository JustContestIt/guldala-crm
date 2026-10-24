"use client";

import { useRouter } from "next/navigation";
import { useEffect } from "react";

// Re-reads the page while something runs on the server (a broadcast going out)
export function AutoRefresh({ seconds }: { seconds: number }) {
  const router = useRouter();
  useEffect(() => {
    const t = setInterval(() => router.refresh(), seconds * 1000);
    return () => clearInterval(t);
  }, [router, seconds]);
  return null;
}
