-- Team composition is no longer a host-configured setting — matches now
-- accept whatever split of players actually shows up and readies up.
ALTER TABLE "Room" DROP COLUMN "minPlayersToStart";
ALTER TABLE "Room" DROP COLUMN "playersPerTeam";
ALTER TABLE "Room" DROP COLUMN "coachesPerTeam";
