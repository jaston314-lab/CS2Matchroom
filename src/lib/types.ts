// Shared string-union "enums" — SQLite has no native enum type, so these
// columns are plain strings in Prisma. Validate against these unions at
// every write boundary (server actions / route handlers).

export const ROLES = ["ADMIN", "HOST", "PLAYER"] as const;
export type Role = (typeof ROLES)[number];

export const ROOM_STATUSES = [
  "LOBBY",
  "VETO",
  "READY",
  "LIVE",
  "COMPLETED",
  "CANCELLED",
] as const;
export type RoomStatus = (typeof ROOM_STATUSES)[number];

export const FORMATS = ["BO1", "BO3", "BO5"] as const;
export type Format = (typeof FORMATS)[number];

export function mapsRequiredForFormat(format: Format): number {
  return format === "BO1" ? 1 : format === "BO3" ? 3 : 5;
}

export const TEAMS = ["A", "B", "UNASSIGNED"] as const;
export type Team = (typeof TEAMS)[number];

export const VETO_STATUSES = ["NOT_STARTED", "IN_PROGRESS", "DONE"] as const;
export type VetoStatus = (typeof VETO_STATUSES)[number];

export const VETO_ACTIONS = ["team1_ban", "team2_ban"] as const;
export type VetoAction = (typeof VETO_ACTIONS)[number];

export interface VetoStep {
  team: "A" | "B";
  map: string;
  action: "ban";
}

export const MATCH_STATUSES = [
  "LOADING",
  "WARMUP",
  "KNIFE",
  "LIVE",
  "PAUSED",
  "COMPLETED",
  "CANCELLED",
] as const;
export type MatchStatus = (typeof MATCH_STATUSES)[number];

export function isRole(value: string): value is Role {
  return (ROLES as readonly string[]).includes(value);
}
