import "server-only";
import RCON from "rcon-srcds";
import { db } from "@/lib/db";
import { decrypt } from "@/lib/crypto";

export interface ResolvedServerConfig {
  rconHost: string;
  rconPort: number;
  rconPassword: string;
  webhookSharedSecret: string;
  appPublicUrl: string;
  localAppUrl: string;
}

export async function getServerConfig(): Promise<ResolvedServerConfig | null> {
  const row = await db.serverConfig.findUnique({ where: { id: "singleton" } });
  if (!row || !row.rconHost) return null;
  return {
    rconHost: row.rconHost,
    rconPort: row.rconPort,
    rconPassword: decrypt(row.rconPasswordEncrypted),
    webhookSharedSecret: row.webhookSharedSecret,
    appPublicUrl: row.appPublicUrl,
    localAppUrl: row.localAppUrl,
  };
}

async function withRcon<T>(
  config: Pick<ResolvedServerConfig, "rconHost" | "rconPort" | "rconPassword">,
  fn: (client: RCON) => Promise<T>,
): Promise<T> {
  const client = new RCON({ host: config.rconHost, port: config.rconPort, timeout: 5000 });
  try {
    await client.authenticate(config.rconPassword);
    return await fn(client);
  } finally {
    await client.disconnect().catch(() => {});
  }
}

/** Quotes a value safely for inclusion as a single console command argument. */
function q(value: string): string {
  return `"${value.replace(/"/g, '\\"')}"`;
}

/**
 * Pushes every convar this app depends on: the webhook/demo-upload URLs and
 * their secrets, demo recording, and GOTV. Despite MatchZy logging these as
 * "persisted to database", testing against the real server showed they
 * don't reliably survive a server restart — matchzy_remote_log_url reverted
 * to a stale placeholder value and tv_enable reverted to off, both after a
 * restart, with no admin action in between. So this doesn't just run once
 * from "Save & apply" — see loadMatch below, which re-runs the exact same
 * thing immediately before every match load, rather than trusting whatever
 * the server currently has configured.
 */
async function applyConfigCommands(client: RCON, config: ResolvedServerConfig): Promise<void> {
  const webhookUrl = `${config.appPublicUrl.replace(/\/$/, "")}/api/matchzy/webhook`;
  // Demo uploads are large binary transfers (tens of MB) — routing them
  // through the public domain and back is bottlenecked by home upload
  // bandwidth and can exceed MatchZy's fixed 60s upload timeout. Use the
  // LAN address if one's set, since RCON already proves the server can
  // reach this app directly.
  const demoUploadBase = config.localAppUrl || config.appPublicUrl;
  const demoUploadUrl = `${demoUploadBase.replace(/\/$/, "")}/api/matchzy/demo`;
  await client.execute(`matchzy_server_id ${q("cs2-matchroom")}`);
  await client.execute(`matchzy_remote_log_url ${q(webhookUrl)}`);
  await client.execute(`matchzy_remote_log_header_key ${q("X-MatchZy-Secret")}`);
  await client.execute(`matchzy_remote_log_header_value ${q(config.webhookSharedSecret)}`);
  await client.execute(`matchzy_demo_upload_url ${q(demoUploadUrl)}`);
  await client.execute(`matchzy_demo_upload_header_key ${q("X-MatchZy-Secret")}`);
  await client.execute(`matchzy_demo_upload_header_value ${q(config.webhookSharedSecret)}`);
  await client.execute(`matchzy_demo_recording_enabled ${q("1")}`);
  // MatchZy's own demo recording just tells GOTV to start/stop — if GOTV
  // itself isn't on, there's nothing to record and the upload fails with
  // "file_not_found" (confirmed against a real server: it logged
  // "GOTV[0] not active." and never wrote a .dem at all).
  await client.execute(`tv_enable ${q("1")}`);
}

/**
 * Sends the RCON command that tells the CS2 server to fetch and load a
 * match config from our /api/matchzy/config/[roomId] endpoint. Re-applies
 * the full config first (see applyConfigCommands) rather than assuming
 * whatever's already configured on the server is still correct.
 */
export async function loadMatch(
  config: ResolvedServerConfig,
  configUrl: string,
): Promise<string | boolean> {
  return withRcon(config, async (client) => {
    await applyConfigCommands(client, config);
    return client.execute(
      `matchzy_loadmatch_url ${q(configUrl)} ${q("X-MatchZy-Secret")} ${q(config.webhookSharedSecret)}`,
    );
  });
}

/** Ends/resets whatever match is currently active on the server. */
export async function endMatch(config: ResolvedServerConfig): Promise<string | boolean> {
  return withRcon(config, (client) => client.execute("css_endmatch"));
}

/**
 * Applies the webhook/server-id convars so matchzy_remote_log_url points
 * at this app. Run whenever the admin saves server config — loadMatch above
 * also re-runs this same set immediately before every match, since it
 * doesn't reliably survive a server restart on its own.
 */
export async function applyServerConfig(config: ResolvedServerConfig): Promise<void> {
  await withRcon(config, (client) => applyConfigCommands(client, config));
}

/** Used by the admin "Test RCON Connection" button. Throws on failure. */
export async function testConnection(
  config: Pick<ResolvedServerConfig, "rconHost" | "rconPort" | "rconPassword">,
): Promise<string> {
  const result = await withRcon(config, (client) => client.execute("hostname"));
  return typeof result === "string" ? result.trim() : "Connected (no hostname returned)";
}
