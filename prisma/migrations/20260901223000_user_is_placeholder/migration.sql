-- AlterTable
-- isPlaceholder starts as a copy of isBot: everything currently marked
-- isBot=true (real fake bots, and real people from an imported demo who
-- haven't logged in yet) is, today, genuinely unclaimed either way. Code
-- going forward stops conflating "fake identity" with "not yet claimed" —
-- see the schema comment on User.isPlaceholder.
ALTER TABLE "User" ADD COLUMN "isPlaceholder" BOOLEAN NOT NULL DEFAULT false;
UPDATE "User" SET "isPlaceholder" = "isBot";
