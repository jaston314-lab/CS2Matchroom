/*
  Warnings:

  - You are about to drop the column `code` on the `Room` table. All the data in the column will be lost.

*/
-- AlterTable
ALTER TABLE "Match" ADD COLUMN "winnerTeam" TEXT;

-- CreateTable
CREATE TABLE "Draft" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "steps" TEXT NOT NULL DEFAULT '[]',
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Draft_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "format" TEXT NOT NULL DEFAULT 'BO1',
    "mapPool" TEXT NOT NULL,
    "knifeRound" BOOLEAN NOT NULL DEFAULT true,
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minPlayersToStart" INTEGER NOT NULL DEFAULT 10,
    "playersPerTeam" INTEGER NOT NULL DEFAULT 5,
    "mode" TEXT NOT NULL DEFAULT 'SELF_SELECT',
    "coachesPerTeam" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Room_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("createdAt", "format", "hostUserId", "id", "knifeRound", "label", "mapPool", "minPlayersToStart", "overtimeEnabled", "playersPerTeam", "status") SELECT "createdAt", "format", "hostUserId", "id", "knifeRound", "label", "mapPool", "minPlayersToStart", "overtimeEnabled", "playersPerTeam", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
CREATE TABLE "new_RoomPlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "team" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isCoach" BOOLEAN NOT NULL DEFAULT false,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomPlayer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_RoomPlayer" ("id", "isCaptain", "isReady", "joinedAt", "roomId", "team", "userId") SELECT "id", "isCaptain", "isReady", "joinedAt", "roomId", "team", "userId" FROM "RoomPlayer";
DROP TABLE "RoomPlayer";
ALTER TABLE "new_RoomPlayer" RENAME TO "RoomPlayer";
CREATE UNIQUE INDEX "RoomPlayer_roomId_userId_key" ON "RoomPlayer"("roomId", "userId");
CREATE TABLE "new_ServerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "rconHost" TEXT NOT NULL DEFAULT '',
    "rconPort" INTEGER NOT NULL DEFAULT 27015,
    "rconPasswordEncrypted" TEXT NOT NULL DEFAULT '',
    "webhookSharedSecret" TEXT NOT NULL DEFAULT '',
    "appPublicUrl" TEXT NOT NULL DEFAULT '',
    "inviteCode" TEXT NOT NULL DEFAULT ''
);
INSERT INTO "new_ServerConfig" ("appPublicUrl", "id", "rconHost", "rconPasswordEncrypted", "rconPort", "webhookSharedSecret") SELECT "appPublicUrl", "id", "rconHost", "rconPasswordEncrypted", "rconPort", "webhookSharedSecret" FROM "ServerConfig";
DROP TABLE "ServerConfig";
ALTER TABLE "new_ServerConfig" RENAME TO "ServerConfig";
CREATE TABLE "new_User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "steamId64" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PLAYER',
    "manualRating" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "wins" INTEGER NOT NULL DEFAULT 0,
    "losses" INTEGER NOT NULL DEFAULT 0
);
INSERT INTO "new_User" ("avatarUrl", "createdAt", "id", "manualRating", "name", "role", "steamId64") SELECT "avatarUrl", "createdAt", "id", "manualRating", "name", "role", "steamId64" FROM "User";
DROP TABLE "User";
ALTER TABLE "new_User" RENAME TO "User";
CREATE UNIQUE INDEX "User_steamId64_key" ON "User"("steamId64");
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;

-- CreateIndex
CREATE UNIQUE INDEX "Draft_roomId_key" ON "Draft"("roomId");
