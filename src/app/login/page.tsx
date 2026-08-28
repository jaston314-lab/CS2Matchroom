import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

const ERROR_MESSAGES: Record<string, string> = {
  steam_unavailable: "Couldn't reach Steam to start login. Try again in a moment.",
  verification_failed: "Steam login couldn't be verified. Try again.",
  not_authenticated: "Steam login was cancelled or failed.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/dashboard");

  const { error } = await searchParams;

  return (
    <div className="max-w-sm mx-auto mt-16 text-center space-y-6">
      <h1 className="text-2xl font-semibold">Sign in</h1>
      <p className="text-neutral-400 text-sm">
        Log in with your Steam account to join or host a match.
      </p>
      {error && (
        <p className="rounded border border-red-800 bg-red-950 text-red-200 text-sm px-3 py-2">
          {ERROR_MESSAGES[error] ?? "Something went wrong signing in."}
        </p>
      )}
      <a
        href="/api/auth/steam/login"
        className="inline-block rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium"
      >
        Sign in through Steam
      </a>
    </div>
  );
}
