import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerConfig } from "@/lib/rcon";
import { getEventType, getMatchzyMatchId, interpretMatchzyEvent } from "@/lib/webhookEvents";

/**
 * Receives matchzy_remote_log_url POSTs from the CS2 server. Always logs
 * the raw payload to MatchEvent (even if we can't fully interpret it), then
 * best-effort updates the denormalized Match row for the live status panel.
 */
export async function POST(request: NextRequest) {
  const config = await getServerConfig();
  if (!config) {
    return new NextResponse("Server not configured", { status: 503 });
  }

  const provided = request.headers.get("x-matchzy-secret");
  if (!provided || provided !== config.webhookSharedSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return new NextResponse("Invalid JSON", { status: 400 });
  }

  const matchzyMatchId = getMatchzyMatchId(payload);
  const match = matchzyMatchId
    ? await db.match.findUnique({ where: { matchzyMatchId } })
    : null;

  if (!match) {
    // Not tied to a match we know about (e.g. server_configured on plugin
    // startup) — nothing to correlate, just acknowledge.
    return NextResponse.json({ ok: true, correlated: false });
  }

  await db.matchEvent.create({
    data: {
      matchId: match.id,
      eventType: getEventType(payload),
      payload: JSON.stringify(payload),
    },
  });

  const update = interpretMatchzyEvent(payload);
  const connectedPlayers = new Set(JSON.parse(match.connectedPlayers) as string[]);
  if (update.connectAdd) connectedPlayers.add(update.connectAdd);
  if (update.connectRemove) connectedPlayers.delete(update.connectRemove);

  // MatchZy's events don't actually carry a map-name field (only
  // map_number) despite the event schema seeming like they might — resolve
  // it from the map list we ourselves generated and stored on the match,
  // instead of a field that's never populated.
  const finalMapIndex = update.currentMapIndex ?? match.currentMapIndex;
  let resolvedMap = update.currentMap ?? match.currentMap;
  if (!resolvedMap) {
    try {
      const maplist = (JSON.parse(match.configJson) as { maplist?: string[] }).maplist;
      resolvedMap = maplist?.[finalMapIndex] ?? resolvedMap;
    } catch {
      // configJson should always be valid JSON we wrote ourselves — ignore if not.
    }
  }

  const finalTeam1Score = update.team1Score ?? match.team1Score;
  const finalTeam2Score = update.team2Score ?? match.team2Score;
  // Only credit wins/losses on the transition *into* COMPLETED — guards
  // against a duplicate webhook delivery double-crediting everyone.
  const justCompleted = update.status === "COMPLETED" && match.status !== "COMPLETED";
  const winnerTeam: "A" | "B" | null = justCompleted
    ? finalTeam1Score === finalTeam2Score
      ? null // tie — shouldn't really happen with clinch_series, but don't credit anyone
      : finalTeam1Score > finalTeam2Score
        ? "A"
        : "B"
    : null;

  await db.match.update({
    where: { id: match.id },
    data: {
      status: update.status ?? match.status,
      team1Score: finalTeam1Score,
      team2Score: finalTeam2Score,
      currentMap: resolvedMap,
      currentMapIndex: finalMapIndex,
      connectedPlayers: JSON.stringify([...connectedPlayers]),
      winnerTeam: winnerTeam ?? undefined,
    },
  });

  if (update.status === "COMPLETED") {
    await db.room.update({ where: { id: match.roomId }, data: { status: "COMPLETED" } });
  }

  if (justCompleted && winnerTeam) {
    const roomPlayers = await db.roomPlayer.findMany({
      where: { roomId: match.roomId, isCoach: false, team: { in: ["A", "B"] } },
    });
    const loserTeam = winnerTeam === "A" ? "B" : "A";
    await db.$transaction([
      ...roomPlayers
        .filter((p) => p.team === winnerTeam)
        .map((p) => db.user.update({ where: { id: p.userId }, data: { wins: { increment: 1 } } })),
      ...roomPlayers
        .filter((p) => p.team === loserTeam)
        .map((p) => db.user.update({ where: { id: p.userId }, data: { losses: { increment: 1 } } })),
    ]);
  }

  return NextResponse.json({ ok: true, correlated: true });
}
