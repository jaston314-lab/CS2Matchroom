import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { submitInviteCode } from "./actions";

export default async function InvitePage() {
  const session = await getSession();
  if (!session.pendingSteamId64) redirect("/login");

  return (
    <div className="hero-glow -mt-8 min-h-[80vh] flex items-center justify-center px-4">
      <div className="max-w-sm w-full text-center space-y-6">
        <div className="space-y-3">
          <p className="text-xs font-medium tracking-[0.3em] text-blue-500 uppercase">
            One more step
          </p>
          <h1 className="text-3xl font-bold tracking-tight">Almost there</h1>
          <p className="text-muted text-sm leading-relaxed">
            We don&apos;t recognize that Steam account yet. If you were invited, enter the code
            you were given to finish creating your account.
          </p>
        </div>

        <form action={submitInviteCode} className="space-y-3">
          <input
            name="inviteCode"
            placeholder="Invite code"
            required
            maxLength={8}
            autoFocus
            className="w-full rounded-xl bg-input border border-line px-4 py-3 text-center text-lg uppercase tracking-[0.4em] placeholder:tracking-normal placeholder:text-muted/70 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="w-full rounded-xl bg-blue-600 hover:bg-blue-500 px-5 py-3 text-white font-semibold shadow-lg shadow-blue-950/50 transition-colors"
          >
            Continue
          </button>
        </form>

        <p className="text-xs text-muted/70">
          Wrong code, or don&apos;t have one? Submitting anything invalid signs you back out.
        </p>
      </div>
    </div>
  );
}
