import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export default async function PlayersLoungePage() {
  await requireUser();
  const users = await db.user.findMany({
    where: { isBot: false },
    orderBy: [{ wins: "desc" }, { name: "asc" }],
  });

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold">Players Lounge</h1>
        <p className="text-sm text-neutral-500">Everyone who&apos;s been invited, ranked by wins.</p>
      </div>
      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/70 text-neutral-400">
            <tr>
              <th className="text-left px-4 py-2.5">Player</th>
              <th className="text-left px-4 py-2.5">Role</th>
              <th className="text-right px-4 py-2.5">Wins</th>
              <th className="text-right px-4 py-2.5">Losses</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/80">
            {users.map((u, i) => (
              <tr key={u.id} className="hover:bg-neutral-900/40 transition-colors">
                <td className="px-4 py-2.5">
                  <span className="flex items-center gap-2">
                    {i === 0 && u.wins > 0 && <span title="Top of the lounge">🏆</span>}
                    {u.avatarUrl && (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full ring-1 ring-neutral-700" />
                    )}
                    {u.name}
                  </span>
                </td>
                <td className="px-4 py-2.5 text-neutral-400">{u.role}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">{u.wins}</td>
                <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{u.losses}</td>
              </tr>
            ))}
            {users.length === 0 && (
              <tr>
                <td colSpan={4} className="px-4 py-6 text-center text-neutral-500">
                  Nobody&apos;s here yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
