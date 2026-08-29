-- RedefineTables
PRAGMA defer_foreign_keys=ON;
PRAGMA foreign_keys=OFF;
CREATE TABLE "new_Room" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "label" TEXT NOT NULL,
    "hostUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SETUP',
    "format" TEXT NOT NULL DEFAULT 'BO1',
    "mapPool" TEXT NOT NULL,
    "knifeRound" BOOLEAN NOT NULL DEFAULT true,
    "overtimeEnabled" BOOLEAN NOT NULL DEFAULT true,
    "minPlayersToStart" INTEGER NOT NULL DEFAULT 10,
    "playersPerTeam" INTEGER NOT NULL DEFAULT 5,
    "mode" TEXT NOT NULL DEFAULT 'SELF_SELECT',
    "teamAName" TEXT NOT NULL DEFAULT 'Team A',
    "teamBName" TEXT NOT NULL DEFAULT 'Team B',
    "coachesPerTeam" INTEGER NOT NULL DEFAULT 1,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Room_hostUserId_fkey" FOREIGN KEY ("hostUserId") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
INSERT INTO "new_Room" ("coachesPerTeam", "createdAt", "format", "hostUserId", "id", "knifeRound", "label", "mapPool", "minPlayersToStart", "mode", "overtimeEnabled", "playersPerTeam", "status") SELECT "coachesPerTeam", "createdAt", "format", "hostUserId", "id", "knifeRound", "label", "mapPool", "minPlayersToStart", "mode", "overtimeEnabled", "playersPerTeam", "status" FROM "Room";
DROP TABLE "Room";
ALTER TABLE "new_Room" RENAME TO "Room";
PRAGMA foreign_keys=ON;
PRAGMA defer_foreign_keys=OFF;
