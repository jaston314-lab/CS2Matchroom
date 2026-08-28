import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";

export async function POST() {
  const session = await getSession();
  session.destroy();
  const base = (process.env.APP_PUBLIC_URL ?? "http://localhost:3000").replace(/\/$/, "");
  return NextResponse.redirect(`${base}/`);
}
