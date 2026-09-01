import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRatingsForRoom } from "@/lib/rating";
import { fetchLeetifyMatchStatsForRoom } from "@/lib/leetifyStats";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { LeetifyStatsStrip } from "@/components/LeetifyStatsStrip";

export default async function PlayersLoungePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  await requireUser();
  const { tab } = await searchParams;
  const activeTab = tab === "games" ? "games" : "players";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Players Lounge</h1>
        <p className="text-sm text-neutral-500">
          {activeTab === "players"
            ? "Everyone who's been invited, ranked by wins."
            : "Match history."}
        </p>
      </div>

      <div className="flex gap-1 border-b border-neutral-800">
        <TabLink href="/lounge" active={activeTab === "players"}>
          Players
        </TabLink>
        <TabLink href="/lounge?tab=games" active={activeTab === "games"}>
          Previous games
        </TabLink>
      </div>

      {activeTab === "players" ? (
        <div className="space-y-2">
          <p className="sm:hidden text-xs text-neutral-500">Swipe the table sideways to see more →</p>
          <PlayersTable />
          <p className="text-xs text-neutral-600">
            Rating is each player&apos;s live Leetify Premier rating when they have one, otherwise
            the manual value they&apos;ve set on their own profile. &quot;Last 30 matches&quot; is
            pulled live from Leetify (matchmaking, Faceit, and wingman combined) and left blank for
            anyone without a public Leetify profile.
          </p>
        </div>
      ) : (
        <PreviousGamesTable />
      )}
    </div>
  );
}

function TabLink({
  href,
  active,
  children,
}: {
  href: string;
  active: boolean;
  children: React.ReactNode;
}) {
  return (
    <Link
      href={href}
      className={`px-3 py-2 text-sm border-b-2 -mb-px transition-colors ${
        active
          ? "border-blue-500 text-white"
          : "border-transparent text-neutral-400 hover:text-neutral-200"
      }`}
    >
      {children}
    </Link>
  );
}

async function PlayersTable() {
  const users = await db.user.findMany({
    where: { isBot: false },
    orderBy: [{ wins: "desc" }, { name: "asc" }],
  });
  const ratings = await resolveRatingsForRoom(
    users.map((u) => ({ steamId64: u.steamId64, manualRating: u.manualRating })),
  );
  const leetifyStats = await fetchLeetifyMatchStatsForRoom(users.map((u) => u.steamId64));

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/70 text-neutral-400">
          <tr>
            <th className="text-left px-4 py-2.5">Player</th>
            <th className="text-left px-4 py-2.5">Role</th>
            <th className="text-right px-4 py-2.5">Rating</th>
            <th className="text-right px-4 py-2.5">Wins</th>
            <th className="text-right px-4 py-2.5">Losses</th>
            <th className="text-left px-4 py-2.5 border-l border-neutral-800">Last 30 matches</th>
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
              <td className="px-4 py-2.5 text-right">
                {ratings.get(u.steamId64)?.rating != null ? (
                  <PremierRatingBadge rating={ratings.get(u.steamId64)!.rating!} />
                ) : (
                  <span className="text-neutral-600">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">{u.wins}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-neutral-500">{u.losses}</td>
              <td className="px-4 py-2.5 border-l border-neutral-800/80">
                <LeetifyStatsStrip stats={leetifyStats.get(u.steamId64) ?? null} />
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                Nobody&apos;s here yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

async function PreviousGamesTable() {
  const previousGames = await db.room.findMany({
    where: { status: { in: ["COMPLETED", "CANCELLED"] } },
    include: { host: true, match: true, _count: { select: { players: true } } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-neutral-800">
      <table className="w-full text-sm">
        <thead className="bg-neutral-900/70 text-neutral-400">
          <tr>
            <th className="text-left px-4 py-2.5">Match</th>
            <th className="text-left px-4 py-2.5">Host</th>
            <th className="text-left px-4 py-2.5">Result</th>
            <th className="text-left px-4 py-2.5">Players</th>
            <th className="text-left px-4 py-2.5">Date</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-neutral-800/80">
          {previousGames.map((room) => (
            <tr key={room.id} className="hover:bg-neutral-900/40 transition-colors">
              <td className="px-4 py-2.5">{room.label}</td>
              <td className="px-4 py-2.5">{room.host.name}</td>
              <td className="px-4 py-2.5 text-neutral-400">
                {room.status === "CANCELLED" && "Cancelled"}
                {room.status === "COMPLETED" && room.match ? (
                  <>
                    {room.match.winnerTeam === "A" ? room.teamAName : room.teamBName} won ·{" "}
                    {room.match.team1Score}–{room.match.team2Score}
                  </>
                ) : (
                  room.status === "COMPLETED" && "Completed"
                )}
              </td>
              <td className="px-4 py-2.5">{room._count.players}</td>
              <td className="px-4 py-2.5 text-neutral-400">{room.createdAt.toLocaleDateString()}</td>
            </tr>
          ))}
          {previousGames.length === 0 && (
            <tr>
              <td colSpan={5} className="px-4 py-6 text-center text-neutral-500">
                No games played yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
