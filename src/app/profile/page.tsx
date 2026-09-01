import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolvePlayerRating } from "@/lib/rating";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { updateManualRating } from "./actions";

export default async function ProfilePage() {
  const user = await requireUser();
  const resolved = await resolvePlayerRating({
    steamId64: user.steamId64,
    manualRating: user.manualRating,
  });
  // requireUser()'s CurrentUser is a lightweight session shape without
  // wins/losses — fetch those separately for the record display below.
  const record = await db.user.findUnique({
    where: { id: user.id },
    select: { wins: true, losses: true },
  });

  return (
    <div className="max-w-md mx-auto space-y-8">
      <div className="flex items-center gap-4">
        {user.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded-xl ring-1 ring-neutral-700" />
        )}
        <div>
          <h1 className="text-xl font-semibold">{user.name}</h1>
          <p className="text-sm text-neutral-400">SteamID64: {user.steamId64}</p>
          <p className="text-sm text-neutral-400">Role: {user.role}</p>
          <p className="text-sm mt-0.5">
            <span className="text-emerald-400 font-medium">{record?.wins ?? 0}W</span>{" "}
            <span className="text-neutral-600">–</span>{" "}
            <span className="text-neutral-500 font-medium">{record?.losses ?? 0}L</span>
          </p>
        </div>
      </div>

      <section className="space-y-3">
        <h2 className="text-lg font-medium">CS2 rating</h2>

        <div className="rounded-lg border border-neutral-800 bg-neutral-900/50 px-3 py-2 text-sm">
          {resolved.source !== "none" && resolved.rating != null ? (
            <p className="flex flex-wrap items-center gap-2">
              <span className="text-neutral-400">Currently used for balancing:</span>
              <PremierRatingBadge rating={resolved.rating} />
              <span className="text-neutral-500">
                {resolved.source === "leetify"
                  ? "(live from Leetify)"
                  : "(your manual value below — no Leetify data found)"}
              </span>
            </p>
          ) : (
            <p className="text-neutral-500">
              No Leetify data found and no manual rating set — you&apos;ll be treated as an average
              player when balancing teams.
            </p>
          )}
        </div>

        <p className="text-sm text-neutral-400">
          When balancing teams, the app tries to look up your Premier rating
          from Leetify automatically. If you&apos;ve never used Leetify (or your
          profile is private), it falls back to whatever you set here.
        </p>
        <form action={updateManualRating} className="flex gap-2">
          <input
            name="manualRating"
            type="number"
            min={0}
            max={40000}
            defaultValue={user.manualRating ?? ""}
            placeholder="e.g. 15000"
            className="flex-1 rounded-lg bg-neutral-900 border border-neutral-700 px-3 py-2 focus:border-blue-500 focus:outline-none"
          />
          <button
            type="submit"
            className="rounded-lg bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium transition-colors"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
