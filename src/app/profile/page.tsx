import { requireUser } from "@/lib/auth";
import { updateManualRating } from "./actions";

export default async function ProfilePage() {
  const user = await requireUser();

  return (
    <div className="max-w-md mx-auto space-y-8">
      <div className="flex items-center gap-4">
        {user.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="w-16 h-16 rounded" />
        )}
        <div>
          <h1 className="text-xl font-semibold">{user.name}</h1>
          <p className="text-sm text-neutral-400">SteamID64: {user.steamId64}</p>
          <p className="text-sm text-neutral-400">Role: {user.role}</p>
        </div>
      </div>

      <section>
        <h2 className="text-lg font-medium mb-2">CS2 rating</h2>
        <p className="text-sm text-neutral-400 mb-3">
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
            className="flex-1 rounded bg-neutral-900 border border-neutral-700 px-3 py-2"
          />
          <button
            type="submit"
            className="rounded bg-blue-600 hover:bg-blue-500 px-4 py-2 text-white font-medium"
          >
            Save
          </button>
        </form>
      </section>
    </div>
  );
}
