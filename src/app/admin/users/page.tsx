import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { ROLES } from "@/lib/types";
import { updateUserRole } from "./actions";

export default async function AdminUsersPage() {
  const currentUser = await requireRole(["ADMIN"]);
  const users = await db.user.findMany({ orderBy: { createdAt: "asc" } });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">Users</h1>
      <div className="overflow-x-auto rounded border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900 text-neutral-400">
            <tr>
              <th className="text-left px-4 py-2">Player</th>
              <th className="text-left px-4 py-2">SteamID64</th>
              <th className="text-left px-4 py-2">Rating</th>
              <th className="text-left px-4 py-2">Role</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800">
            {users.map((u) => (
              <tr key={u.id}>
                <td className="px-4 py-2">
                  {u.name}
                  {u.id === currentUser.id && <span className="text-neutral-500"> (you)</span>}
                </td>
                <td className="px-4 py-2 font-mono text-xs text-neutral-400">{u.steamId64}</td>
                <td className="px-4 py-2 text-neutral-400">{u.manualRating ?? "—"}</td>
                <td className="px-4 py-2">
                  <form action={updateUserRole} className="flex items-center gap-2">
                    <input type="hidden" name="userId" value={u.id} />
                    <select
                      name="role"
                      defaultValue={u.role}
                      className="rounded bg-neutral-900 border border-neutral-700 px-2 py-1"
                    >
                      {ROLES.map((role) => (
                        <option key={role} value={role}>
                          {role}
                        </option>
                      ))}
                    </select>
                    <button className="text-xs rounded border border-neutral-700 px-2 py-1 hover:border-neutral-500">
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
