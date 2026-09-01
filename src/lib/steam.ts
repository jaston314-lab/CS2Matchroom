import "server-only";
import { RelyingParty } from "openid";
import { getAppPublicUrl } from "@/lib/appUrl";

const STEAM_OPENID_IDENTIFIER = "https://steamcommunity.com/openid";
const CALLBACK_PATH = "/api/auth/steam/callback";

async function createRelyingParty(): Promise<RelyingParty> {
  const base = await getAppPublicUrl();
  const returnUrl = `${base}${CALLBACK_PATH}`;
  const realm = base;
  // stateless: true — no server-side association store needed, at the cost
  // of one extra verification round-trip to Steam per login. Fine for a
  // small self-hosted app's login volume.
  return new RelyingParty(returnUrl, realm, true, false, []);
}

/** Returns the Steam URL to redirect the browser to for login. */
export async function getSteamLoginUrl(): Promise<string> {
  const relyingParty = await createRelyingParty();
  return new Promise((resolve, reject) => {
    relyingParty.authenticate(STEAM_OPENID_IDENTIFIER, false, (error, authUrl) => {
      if (error || !authUrl) {
        reject(error ?? new Error("Steam did not return a login URL"));
        return;
      }
      resolve(authUrl);
    });
  });
}

/**
 * Verifies the OpenID assertion from Steam's callback redirect and returns
 * the authenticated user's SteamID64, or null if verification failed.
 * `callbackUrl` should be the full URL (matching the returnUrl passed to
 * getSteamLoginUrl) including the query string Steam appended.
 */
export async function verifySteamCallback(callbackUrl: string): Promise<string | null> {
  const relyingParty = await createRelyingParty();
  return new Promise((resolve, reject) => {
    relyingParty.verifyAssertion(callbackUrl, (error, result) => {
      if (error) {
        reject(error);
        return;
      }
      if (!result?.authenticated || !result.claimedIdentifier) {
        resolve(null);
        return;
      }
      const match = result.claimedIdentifier.match(/\/id\/(\d+)$/);
      resolve(match ? match[1] : null);
    });
  });
}

export interface SteamProfile {
  name: string;
  avatarUrl: string | null;
}

/**
 * Looks up display name + avatar via the Steam Web API. Falls back to a
 * generic name if no API key is configured or the call fails, so login
 * still works even before STEAM_API_KEY is set up.
 */
export async function fetchSteamProfile(steamId64: string): Promise<SteamProfile> {
  const apiKey = process.env.STEAM_API_KEY;
  if (!apiKey) {
    return { name: `Player ${steamId64.slice(-4)}`, avatarUrl: null };
  }

  try {
    const url = new URL("https://api.steampowered.com/ISteamUser/GetPlayerSummaries/v2/");
    url.searchParams.set("key", apiKey);
    url.searchParams.set("steamids", steamId64);

    const res = await fetch(url, { cache: "no-store" });
    if (!res.ok) throw new Error(`Steam API responded ${res.status}`);

    const data = (await res.json()) as {
      response?: { players?: { personaname?: string; avatarfull?: string }[] };
    };
    const player = data.response?.players?.[0];
    if (!player) throw new Error("Steam API returned no player");

    return {
      name: player.personaname ?? `Player ${steamId64.slice(-4)}`,
      avatarUrl: player.avatarfull ?? null,
    };
  } catch {
    return { name: `Player ${steamId64.slice(-4)}`, avatarUrl: null };
  }
}
