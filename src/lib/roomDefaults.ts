import { AVAILABLE_MAPS } from "@/lib/maps";

/**
 * Shared by the auto-create-a-room logic (matchroom/page.tsx) and the
 * "Reset settings" action (matchroom/actions.ts) — one source of truth for
 * what a fresh match starts out looking like.
 */
export const DEFAULT_ROOM_SETTINGS = {
  label: "Scrim",
  format: "BO1" as const,
  mode: "SELF_SELECT" as const,
  mapPool: AVAILABLE_MAPS.map((m) => m.id),
  knifeRound: true,
  overtimeEnabled: true,
  simulation: false,
};
