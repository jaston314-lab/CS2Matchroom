import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { getAppPublicUrl } from "@/lib/appUrl";

export async function POST() {
  const session = await getSession();
  session.destroy();
  const base = await getAppPublicUrl();
  return NextResponse.redirect(`${base}/`);
}
