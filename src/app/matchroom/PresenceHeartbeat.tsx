"use client";

import { useEffect } from "react";
import { heartbeatAction } from "./actions";

/**
 * Keeps this viewer's RoomPlayer.lastSeenAt fresh while the matchroom page
 * is open, so the waiting pool can stop showing someone once they've
 * actually closed the tab (see the staleness check in page.tsx). Errors are
 * swallowed — a missed heartbeat just means they show as away a beat later,
 * not worth surfacing to the user.
 */
export function PresenceHeartbeat({ intervalMs = 3000 }: { intervalMs?: number }) {
  useEffect(() => {
    heartbeatAction().catch(() => {});
    const id = setInterval(() => {
      heartbeatAction().catch(() => {});
    }, intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  return null;
}
