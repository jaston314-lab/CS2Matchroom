import { redirect } from "next/navigation";
import { getCurrentUser } from "@/lib/auth";

const ERROR_MESSAGES: Record<string, string> = {
  steam_unavailable: "Couldn't reach Steam to start login. Try again in a moment.",
  verification_failed: "Steam login couldn't be verified. Try again.",
  not_authenticated: "Steam login was cancelled or failed.",
  invalid_invite:
    "That invite code wasn't right, so you've been signed out. Ask whoever invited you and try again.",
};

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const user = await getCurrentUser();
  if (user) redirect("/matchroom");

  const { error } = await searchParams;

  return (
    <div className="hero-glow -mt-8 min-h-[80vh] flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-8">
        <div className="space-y-3">
          <p className="text-xs font-medium tracking-[0.3em] text-blue-500 uppercase">
            Invite only
          </p>
          <h1 className="text-4xl font-bold tracking-tight">
            <span className="text-blue-500">CS2</span> Matchroom
          </h1>
          <p className="text-neutral-400 text-sm leading-relaxed">
            Casual 5v5s with the crew. Sign in with Steam, ready up, and the match loads straight
            onto the server.
          </p>
        </div>

        {error && (
          <p className="rounded-lg border border-red-800 bg-red-950/60 text-red-200 text-sm px-4 py-2.5">
            {ERROR_MESSAGES[error] ?? "Something went wrong signing in."}
          </p>
        )}

        <a
          href="/api/auth/steam/login"
          className="group inline-flex w-full items-center justify-center gap-2 rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-3 text-white font-semibold shadow-lg shadow-blue-950/50 transition-colors"
        >
          <SignInGlyph />
          Sign in through Steam
        </a>

        <p className="text-xs text-neutral-600">
          Already a member? Just sign in. New here? You&apos;ll be asked for an invite code after
          connecting your Steam account.
        </p>
      </div>
    </div>
  );
}

function SignInGlyph() {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      className="w-5 h-5 shrink-0 transition-transform group-hover:translate-x-0.5"
    >
      <path
        d="M13 4l7 8-7 8M4 12h15"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
