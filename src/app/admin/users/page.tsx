import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/types";
import { resolveRatingsForRoom } from "@/lib/rating";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { updateUserRole } from "./actions";
import { DeleteUserButton } from "./DeleteUserButton";

export default async function AdminUsersPage() {
  const currentUser = await requireRole(["ADMIN"]);
  // Placeholders (test bots, and real people from an imported demo who
  // haven't logged in yet) have nothing to manage here — no role to set,
  // and test bots would otherwise pile up 9-10 at a time.
  const users = await db.user.findMany({ where: { isPlaceholder: false }, orderBy: { createdAt: "asc" } });
  const ratings = await resolveRatingsForRoom(
    users.map((u) => ({ steamId64: u.steamId64, manualRating: u.manualRating })),
  );

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <p className="sm:hidden text-xs text-muted">Swipe the table sideways to see more →</p>
      <div className="overflow-x-auto rounded-xl border border-line bg-panel">
        <table className="w-full text-sm">
          <thead className="bg-input/70 text-muted">
            <tr>
              <th className="text-left px-4 py-2.5">Player</th>
              <th className="text-left px-4 py-2.5">SteamID64</th>
              <th className="text-left px-4 py-2.5">Rating</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-line/80">
            {users.map((u) => (
              <tr key={u.id} className="hover:bg-input/40 transition-colors">
                <td className="px-4 py-2.5">
                  {u.name}
                  {u.id === currentUser.id && <span className="text-muted"> (you)</span>}
                </td>
                <td className="px-4 py-2.5 font-mono text-xs text-muted">{u.steamId64}</td>
                <td className="px-4 py-2.5">
                  {ratings.get(u.steamId64)?.rating != null ? (
                    <PremierRatingBadge rating={ratings.get(u.steamId64)!.rating!} />
                  ) : (
                    <span className="text-muted/70">—</span>
                  )}
                </td>
                <td className="px-4 py-2.5">
                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <select
                      key={u.role}
                      name="role"
                      defaultValue={u.role}
                      className="rounded-lg bg-input border border-line px-2 py-1 focus:border-blue-500 focus:outline-none"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <button className="text-xs rounded-lg border border-line px-2 py-1 hover:border-blue-500 transition-colors">
                      Save
                    </button>
                  </form>
                </td>
                <td className="px-4 py-2.5 text-right">
                  {u.id !== currentUser.id && <DeleteUserButton userId={u.id} name={u.name} />}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
