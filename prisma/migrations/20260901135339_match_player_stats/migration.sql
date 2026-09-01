-- CreateTable
CREATE TABLE "MatchPlayerStats" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "matchId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "team" TEXT NOT NULL,
    "kills" INTEGER NOT NULL,
    "deaths" INTEGER NOT NULL,
    "assists" INTEGER NOT NULL,
    "headshotKills" INTEGER NOT NULL,
    "damage" INTEGER NOT NULL,
    "roundsPlayed" INTEGER NOT NULL,
    "mvps" INTEGER NOT NULL DEFAULT 0,
    "score" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "MatchPlayerStats_matchId_fkey" FOREIGN KEY ("matchId") REFERENCES "Match" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MatchPlayerStats_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

-- CreateIndex
CREATE UNIQUE INDEX "MatchPlayerStats_matchId_userId_key" ON "MatchPlayerStats"("matchId", "userId");
