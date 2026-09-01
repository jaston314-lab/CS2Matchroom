import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/types";
import { resolveRatingsForRoom } from "@/lib/rating";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { updateUserRole } from "./actions";

export default async function AdminUsersPage() {
  const currentUser = await requireRole(["ADMIN"]);
  // Bots created by test mode's "fill with bots" have nothing to manage
  // here (no role to set) and would otherwise pile up 9-10 at a time.
  const users = await db.user.findMany({ where: { isBot: false }, orderBy: { createdAt: "asc" } });
  const ratings = await resolveRatingsForRoom(
    users.map((u) => ({ steamId64: u.steamId64, manualRating: u.manualRating })),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="sm:hidden text-xs text-neutral-500">Swipe the table sideways to see more →</p>
      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/70 text-neutral-400">
            <tr>
              <th className="text-left px-4 py-2.5">Player</th>
              <th className="text-left px-4 py-2.5">SteamID64</th>
              <th className="text-left px-4 py-2.5">Rating</th>
              <th className="text-left px-4 py-2.5">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/80">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-neutral-900/40 transition-colors">
                <td className="px-4 py-2.5">
                  {u.name}
                  {u.id === currentUser.id && <span className="text-neutral-500"> (you)</span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-neutral-400">{u.steamId64}</td>
                <td className="px-4 py-2.5">
                  {ratings.get(u.steamId64)?.rating != null ? (
                    <PremierRatingBadge rating={ratings.get(u.steamId64)!.rating!} />
                  ) : (
                    <span className="text-neutral-600">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <select
                      name="role"
                      defaultValue={u.role}
                      className="rounded-lg bg-neutral-900 border border-neutral-700 px-2 py-1 focus:border-blue-500 focus:outline-none"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <button className="text-xs rounded-lg border border-neutral-700 px-2 py-1 hover:border-blue-500 transition-colors">
                      Save
                    </button>
                  </form>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
