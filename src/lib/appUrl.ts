import "server-only";
import { db } from "@/lib/db";

/**
 * The URL players' browsers use to reach this app — used for Steam OpenID
 * login redirects. Single source of truth is ServerConfig.appPublicUrl
 * (the "App public URL" field on /admin/server), so nothing here should
 * ever need .env touched again after the very first deploy.
 *
 * .env's APP_PUBLIC_URL only matters for the *first* login ever (there's
 * no admin yet to have set anything on /admin/server, and that first
 * login is what creates the admin account) — after that, whatever's
 * saved in the DB always wins.
 */
export async function getAppPublicUrl(): Promise<string> {
  const config = await db.serverConfig.findUnique({ where: { id: "singleton" } });
  const url = config?.appPublicUrl || process.env.APP_PUBLIC_URL;
  if (!url) {
    throw new Error(
      "No public URL configured — set APP_PUBLIC_URL in .env for the very first login (before an admin " +
        "account exists to configure anything), then set it permanently on /admin/server.",
    );
  }
  return url.replace(/\/$/, "");
}
