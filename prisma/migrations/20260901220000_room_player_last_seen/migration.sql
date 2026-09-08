-- AlterTable
-- SQLite requires a constant default for ADD COLUMN (CURRENT_TIMESTAMP is
-- rejected as "non-constant") — existing rows just get backfilled with a
-- fixed past timestamp, which is harmless: they'll simply look "stale"
-- until their next heartbeat, self-correcting within a few seconds.
ALTER TABLE "RoomPlayer" ADD COLUMN "lastSeenAt" DATETIME NOT NULL DEFAULT '2026-01-01 00:00:00';
