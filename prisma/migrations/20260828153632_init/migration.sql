-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "steamId64" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "avatarUrl" TEXT,
    "role" TEXT NOT NULL DEFAULT 'PLAYER',
    "manualRating" REAL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- CreateTable
CREATE TABLE "Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOBBY',
    "format" TEXT NOT NULL DEFAULT 'BO1',
    "mapPool" TEXT NOT NULL,
    "knifeRound" BOOLEAN NOT NULL DEFAULT true,
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minPlayersToStart" INTEGER NOT NULL DEFAULT 10,
    "playersPerTeam" INTEGER NOT NULL DEFAULT 5,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Room_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "RoomPlayer" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "team" TEXT NOT NULL DEFAULT 'UNASSIGNED',
    "isCaptain" BOOLEAN NOT NULL DEFAULT false,
    "isReady" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RoomPlayer_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoomPlayer_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Veto" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NOT_STARTED',
    "steps" TEXT NOT NULL DEFAULT '[]',
    "finalMapList" TEXT,
    "overriddenByHost" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Veto_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "Match" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "roomId" TEXT NOT NULL,
    "matchzyMatchId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'LOADING',
    "currentMapIndex" INTEGER NOT NULL DEFAULT 0,
    "currentMap" TEXT,
    "team1Score" INTEGER NOT NULL DEFAULT 0,
    "team2Score" INTEGER NOT NULL DEFAULT 0,
    "connectedPlayers" TEXT NOT NULL DEFAULT '[]',
    "configJson" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL,
    CONSTRAINT "Match_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "Room" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "MatchEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payload" TEXT NOT NULL,
    "receivedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MatchEvent_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

-- CreateTable
CREATE TABLE "ServerConfig" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "rconHost" TEXT NOT NULL DEFAULT '',
    "rconPort" INTEGER NOT NULL DEFAULT 27015,
    "rconPasswordEncrypted" TEXT NOT NULL DEFAULT '',
    "webhookSharedSecret" TEXT NOT NULL DEFAULT '',
    "appPublicUrl" TEXT NOT NULL DEFAULT ''
);

-- CreateIndex
CREATE UNIQUE INDEX "User_steamId64_key" ON "User"("steamId64");

-- CreateIndex
CREATE UNIQUE INDEX "Room_code_key" ON "Room"("code");

-- CreateIndex
CREATE UNIQUE INDEX "RoomPlayer_roomId_userId_key" ON "RoomPlayer"("roomId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "Veto_roomId_key" ON "Veto"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_roomId_key" ON "Match"("roomId");

-- CreateIndex
CREATE UNIQUE INDEX "Match_matchzyMatchId_key" ON "Match"("matchzyMatchId");

-- CreateIndex
CREATE INDEX "MatchEvent_matchId_idx" ON "MatchEvent"("matchId");
