"use server";

import { redirect } from "next/navigation";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { encrypt, decrypt } from "@/lib/crypto";
import { applyServerConfig, testConnection } from "@/lib/rcon";
import { generateInviteCode } from "@/lib/inviteCode";

function redirectWithParams(params: Record<string, string>): never {
  const search = new URLSearchParams(params).toString();
  redirect(`/admin/server?${search}`);
}

async function readFormConfig(formData: FormData) {
  const rconHost = String(formData.get("rconHost") ?? "").trim();
  const rconPort = Number(formData.get("rconPort") ?? 27015);
  const rconPasswordInput = String(formData.get("rconPassword") ?? "");
  const webhookSharedSecret = String(formData.get("webhookSharedSecret") ?? "").trim();
  const appPublicUrl = String(formData.get("appPublicUrl") ?? "").trim();
  const gameConnectAddress = String(formData.get("gameConnectAddress") ?? "").trim();
  const localAppUrl = String(formData.get("localAppUrl") ?? "").trim();

  if (!rconHost) throw new Error("RCON host is required");
  if (!Number.isInteger(rconPort) || rconPort < 1 || rconPort > 65535) {
    throw new Error("RCON port must be a valid port number");
  }

  let rconPassword = rconPasswordInput;
  if (!rconPassword) {
    // Blank means "keep existing" — the password field is never
    // pre-filled with the real value in the form.
    const existing = await db.serverConfig.findUnique({ where: { id: "singleton" } });
    rconPassword = existing ? decrypt(existing.rconPasswordEncrypted) : "";
  }

  return { rconHost, rconPort, rconPassword, webhookSharedSecret, appPublicUrl, gameConnectAddress, localAppUrl };
}

export async function saveServerConfigAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const config = await readFormConfig(formData);

  await db.serverConfig.upsert({
    where: { id: "singleton" },
    update: {
      rconHost: config.rconHost,
      rconPort: config.rconPort,
      rconPasswordEncrypted: encrypt(config.rconPassword),
      webhookSharedSecret: config.webhookSharedSecret,
      appPublicUrl: config.appPublicUrl,
      gameConnectAddress: config.gameConnectAddress,
      localAppUrl: config.localAppUrl,
    },
    create: {
      id: "singleton",
      rconHost: config.rconHost,
      rconPort: config.rconPort,
      rconPasswordEncrypted: encrypt(config.rconPassword),
      webhookSharedSecret: config.webhookSharedSecret,
      appPublicUrl: config.appPublicUrl,
      gameConnectAddress: config.gameConnectAddress,
      localAppUrl: config.localAppUrl,
    },
  });

  try {
    await applyServerConfig(config);
  } catch (error) {
    redirectWithParams({ saved: "1", applyError: (error as Error).message });
  }
  redirectWithParams({ saved: "1" });
}

export async function regenerateInviteCodeAction(): Promise<void> {
  await requireRole(["ADMIN"]);
  const code = generateInviteCode();
  await db.serverConfig.upsert({
    where: { id: "singleton" },
    update: { inviteCode: code },
    create: { id: "singleton", inviteCode: code },
  });
  redirectWithParams({ inviteRegenerated: "1" });
}

export async function testRconConnectionAction(formData: FormData): Promise<void> {
  await requireRole(["ADMIN"]);
  const config = await readFormConfig(formData);

  // redirect() works by throwing — it must never be called inside a try
  // block that has a catch below it, or Next.js's own redirect throw gets
  // swallowed as if it were a real error from testConnection() (this is
  // exactly what produced "Connection failed: NEXT_REDIRECT" on a
  // successful test).
  let hostname: string;
  try {
    hostname = await testConnection(config);
  } catch (error) {
    redirectWithParams({ testOk: "0", testError: (error as Error).message });
  }
  redirectWithParams({ testOk: "1", testHostname: hostname });
}
