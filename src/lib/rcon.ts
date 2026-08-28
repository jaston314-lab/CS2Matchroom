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
 * Sends the RCON command that tells the CS2 server to fetch and load a
 * match config from our /api/matchzy/config/[roomId] endpoint.
 */
export async function loadMatch(
  config: ResolvedServerConfig,
  configUrl: string,
): Promise<string | boolean> {
  return withRcon(config, (client) =>
    client.execute(
      `matchzy_loadmatch_url ${q(configUrl)} ${q("X-MatchZy-Secret")} ${q(config.webhookSharedSecret)}`,
    ),
  );
}

/** Ends/resets whatever match is currently active on the server. */
export async function endMatch(config: ResolvedServerConfig): Promise<string | boolean> {
  return withRcon(config, (client) => client.execute("css_endmatch"));
}

/**
 * Applies the webhook/server-id convars so matchzy_remote_log_url points
 * at this app. Run whenever the admin saves server config.
 */
export async function applyServerConfig(config: ResolvedServerConfig): Promise<void> {
  const webhookUrl = `${config.appPublicUrl.replace(/\/$/, "")}/api/matchzy/webhook`;
  await withRcon(config, async (client) => {
    await client.execute(`matchzy_server_id ${q("cs2-matchroom")}`);
    await client.execute(`matchzy_remote_log_url ${q(webhookUrl)}`);
    await client.execute(`matchzy_remote_log_header_key ${q("X-MatchZy-Secret")}`);
    await client.execute(`matchzy_remote_log_header_value ${q(config.webhookSharedSecret)}`);
  });
}

/** Used by the admin "Test RCON Connection" button. Throws on failure. */
export async function testConnection(
  config: Pick<ResolvedServerConfig, "rconHost" | "rconPort" | "rconPassword">,
): Promise<string> {
  const result = await withRcon(config, (client) => client.execute("hostname"));
  return typeof result === "string" ? result.trim() : "Connected (no hostname returned)";
}
