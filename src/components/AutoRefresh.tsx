"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Keeps a Server Component page "live" for every viewer by periodically
 * re-running the server render and swapping in the fresh result — no
 * websockets, no parallel client-side data-fetching layer. Good enough for
 * a small friend-group app; the tradeoff is a full page data re-fetch per
 * tick for every connected viewer rather than push-based updates.
 */
export function AutoRefresh({ intervalMs = 3000 }: { intervalMs?: number }) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
