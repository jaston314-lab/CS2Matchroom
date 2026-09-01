import fs from "node:fs";
import path from "node:path";
import { NextRequest, NextResponse } from "next/server";
import AdmZip from "adm-zip";
import { db } from "@/lib/db";
import { getServerConfig } from "@/lib/rcon";
import { attachDemoToMatch } from "@/lib/demoImport";

const DEMOS_DIR = path.join(process.cwd(), "data", "demos");

/**
 * Receives matchzy_demo_upload_url POSTs from the CS2 server — fired once
 * per map when GOTV demo recording stops. Body is the raw bytes of a
 * zipped demo (application/octet-stream, not multipart); metadata comes
 * via headers, not the JSON body the other MatchZy endpoints use. See
 * https://me.sivert.io/commands/ for the convar names this depends on
 * (matchzy_demo_upload_url/_header_key/_header_value, set from
 * /admin/server's "Save & apply" or its console-commands box).
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

  const matchzyMatchId =
    request.headers.get("matchzy-matchid") ?? request.headers.get("get5-matchid");
  const fileName =
    request.headers.get("matchzy-filename") ?? request.headers.get("get5-filename") ?? "demo.zip";

  if (!matchzyMatchId) {
    return new NextResponse("Missing MatchZy-MatchId header", { status: 400 });
  }

  const match = await db.match.findUnique({ where: { matchzyMatchId } });
  if (!match) {
    // Not a match we know about — acknowledge anyway so MatchZy doesn't
    // retry forever, but don't try to process it.
    return NextResponse.json({ ok: true, correlated: false });
  }

  const body = Buffer.from(await request.arrayBuffer());

  // Keep the raw upload around regardless of whether parsing succeeds —
  // easiest way to retry a failed import by hand later.
  fs.mkdirSync(DEMOS_DIR, { recursive: true });
  const savedName = `${match.id}-${Date.now()}-${fileName.replace(/[^\w.-]/g, "_")}`;
  fs.writeFileSync(path.join(DEMOS_DIR, savedName), body);

  // Respond as soon as the file's safely on disk — MatchZy's own HttpClient
  // has a fixed 60s timeout on the whole upload (a real one, hit in
  // testing: a large demo can eat that budget on transfer alone before we
  // even get to parsing). Unzipping and walking every tick of a full match
  // shouldn't also compete for that same window, so it happens after
  // responding rather than before. Safe here specifically because this app
  // runs as a persistent Node process (self-hosted, not a serverless
  // function that gets frozen once a response is sent) — the event loop
  // keeps going regardless of what MatchZy does with the connection.
  processDemo(match.id, body, fileName).catch((error) => {
    console.error(`Failed to parse/attach demo for match ${match.id}:`, error);
  });

  return NextResponse.json({ ok: true, correlated: true, processing: true });
}

async function processDemo(matchId: string, body: Buffer, fileName: string): Promise<void> {
  let demoBuffer: Buffer = body;
  const isZip = body.length > 4 && body.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]));
  if (isZip) {
    const zip = new AdmZip(body);
    const demoEntry = zip.getEntries().find((e) => /\.dem(\.zst)?$/i.test(e.entryName));
    if (!demoEntry) {
      throw new Error(`Zip upload (${fileName}) didn't contain a .dem file`);
    }
    demoBuffer = demoEntry.getData();
  }

  await attachDemoToMatch(matchId, demoBuffer);
}
