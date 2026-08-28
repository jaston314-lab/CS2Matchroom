import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

export default async function Home() {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  return (
    <div className="max-w-xl mx-auto mt-16 text-center space-y-6">
      <h1 className="text-3xl font-semibold tracking-tight">CS2 Matchroom</h1>
      <p className="text-neutral-400">
        Casual 5v5s with the crew — join a room, ready up, and the match loads
        straight onto the server through MatchZy.
      </p>
      <a
        href="/api/auth/steam/login"
        className="inline-block rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium"
      >
        Sign in through Steam
      </a>
    </div>
  );
}
