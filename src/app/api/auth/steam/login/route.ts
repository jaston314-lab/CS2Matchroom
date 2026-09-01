import { NextResponse } from "next/server";
import { getSteamLoginUrl } from "@/lib/steam";
import { getAppPublicUrl } from "@/lib/appUrl";

async function redirectTo(path: string) {
  const base = await getAppPublicUrl();
  return NextResponse.redirect(`${base}${path}`);
}

export async function GET() {
  try {
    const url = await getSteamLoginUrl();
    return NextResponse.redirect(url);
  } catch (error) {
    console.error("Failed to start Steam login:", error);
    return redirectTo("/login?error=steam_unavailable");
  }
}
