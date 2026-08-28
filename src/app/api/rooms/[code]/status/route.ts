import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { db } from "@/lib/db";

/** Polled by the room page's live status panel while a match is running. */
export async function GET(_request: Request, { params }: { params: Promise<{ code: string }> }) {
  const user = await getCurrentUser();
  if (!user) return new NextResponse("Unauthorized", { status: 401 });

  const { code } = await params;
  const room = await db.room.findUnique({ where: { code }, include: { match: true } });
  if (!room) return new NextResponse("Not found", { status: 404 });

  return NextResponse.json({
    roomStatus: room.status,
    match: room.match
      ? {
          status: room.match.status,
          currentMap: room.match.currentMap,
          currentMapIndex: room.match.currentMapIndex,
          team1Score: room.match.team1Score,
          team2Score: room.match.team2Score,
          connectedPlayers: JSON.parse(room.match.connectedPlayers) as string[],
        }
      : null,
  });
}
