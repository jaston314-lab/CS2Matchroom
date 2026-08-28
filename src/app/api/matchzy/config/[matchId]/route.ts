import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getServerConfig } from "@/lib/rcon";

/**
 * Fetched by the CS2 server itself in response to the RCON
 * `matchzy_loadmatch_url` command — not called by the browser. Gated by
 * the shared secret set in /admin/server (sent as the X-MatchZy-Secret
 * header, configured on the RCON command).
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ matchId: string }> },
) {
  const config = await getServerConfig();
  if (!config) {
    return new NextResponse("Server not configured", { status: 503 });
  }

  const provided = request.headers.get("x-matchzy-secret");
  if (!provided || provided !== config.webhookSharedSecret) {
    return new NextResponse("Unauthorized", { status: 401 });
  }

  const { matchId } = await params;
  const match = await db.match.findUnique({ where: { id: matchId } });
  if (!match) {
    return new NextResponse("Not found", { status: 404 });
  }

  return new NextResponse(match.configJson, {
    headers: { "Content-Type": "application/json" },
  });
}
