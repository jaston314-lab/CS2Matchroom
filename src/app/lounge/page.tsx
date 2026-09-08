import Link from "next/link";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { resolveRatingsForRoom } from "@/lib/rating";
import { fetchLeetifyMatchStatsForRoom } from "@/lib/leetifyStats";
import { PremierRatingBadge } from "@/components/PremierRatingBadge";
import { LeetifyStatsStrip } from "@/components/LeetifyStatsStrip";
import { DeleteGameButton } from "./DeleteGameButton";

export default async function PlayersLoungePage({
  searchParams,
}: {
  searchParams: Promise<{ tab?: string }>;
}) {
  const user = await requireUser();
  const { tab } = await searchParams;
  const activeTab = tab === "games" ? "games" : "players";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">Players Lounge</h1>
        <p className="text-sm text-muted">
          {activeTab === "players"
            ? "Everyone who's been invited, ranked by wins."
            : "Match history."}
        </p>
      </div>

      <div className="flex gap-1 border-b border-line">
        <TabLink href="/lounge" active={activeTab === "players"}>
          Players
        </TabLink>
        <TabLink href="/lounge?tab=games" active={activeTab === "games"}>
          Previous games
        </TabLink>
      </div>

      {activeTab === "players" ? (
        <div className="space-y-2">
          <p className="sm:hidden text-xs text-muted">Swipe the table sideways to see more →</p>
          <PlayersTable />
          <p className="text-xs text-muted/70">
            Rating is each player&apos;s live Leetify Premier rating when they have one, otherwise
            the manual value they&apos;ve set on their own profile. &quot;Last 30 matches&quot; is
            pulled live from Leetify (matchmaking, Faceit, and wingman combined) and left blank for
            anyone without a public Leetify profile.
          </p>
        </div>
      ) : (
        <PreviousGamesTable isAdmin={user.role === "ADMIN"} />
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
          : "border-transparent text-muted hover:text-ink"
      }`}
    >
      {children}
    </Link>
  );
}

async function PlayersTable() {
  const users = await db.user.findMany({
    where: { isPlaceholder: false },
    orderBy: [{ wins: "desc" }, { name: "asc" }],
  });
  const ratings = await resolveRatingsForRoom(
    users.map((u) => ({ steamId64: u.steamId64, manualRating: u.manualRating })),
  );
  const leetifyStats = await fetchLeetifyMatchStatsForRoom(
    users.map((u) => ({ steamId64: u.steamId64, isBot: u.isBot })),
  );

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full text-sm">
        <thead className="bg-input/70 text-muted">
          <tr>
            <th className="text-left px-4 py-2.5">Player</th>
            <th className="text-left px-4 py-2.5">Role</th>
            <th className="text-right px-4 py-2.5">Rating</th>
            <th className="text-right px-4 py-2.5">Wins</th>
            <th className="text-right px-4 py-2.5">Losses</th>
            <th className="text-left px-4 py-2.5 border-l border-line">Last 30 matches</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line/80">
          {users.map((u, i) => (
            <tr key={u.id} className="hover:bg-input/40 transition-colors">
              <td className="px-4 py-2.5">
                <span className="flex items-center gap-2">
                  {i === 0 && u.wins > 0 && <span title="Top of the lounge">🏆</span>}
                  {u.avatarUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={u.avatarUrl} alt="" className="w-6 h-6 rounded-full border border-line" />
                  )}
                  {u.name}
                </span>
              </td>
              <td className="px-4 py-2.5 text-muted">{u.role}</td>
              <td className="px-4 py-2.5 text-right">
                {ratings.get(u.steamId64)?.rating != null ? (
                  <PremierRatingBadge rating={ratings.get(u.steamId64)!.rating!} />
                ) : (
                  <span className="text-muted/70">—</span>
                )}
              </td>
              <td className="px-4 py-2.5 text-right tabular-nums text-emerald-400">{u.wins}</td>
              <td className="px-4 py-2.5 text-right tabular-nums text-muted">{u.losses}</td>
              <td className="px-4 py-2.5 border-l border-line/80">
                <LeetifyStatsStrip stats={leetifyStats.get(u.steamId64) ?? null} />
              </td>
            </tr>
          ))}
          {users.length === 0 && (
            <tr>
              <td colSpan={6} className="px-4 py-6 text-center text-muted">
                Nobody&apos;s here yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}

async function PreviousGamesTable({ isAdmin }: { isAdmin: boolean }) {
  const previousGames = await db.room.findMany({
    where: { status: { in: ["COMPLETED", "CANCELLED"] } },
    include: { host: true, match: true, _count: { select: { players: true } } },
    orderBy: { createdAt: "desc" },
    take: 25,
  });

  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-panel">
      <table className="w-full text-sm">
        <thead className="bg-input/70 text-muted">
          <tr>
            <th className="text-left px-4 py-2.5">Match</th>
            <th className="text-left px-4 py-2.5">Host</th>
            <th className="text-left px-4 py-2.5">Result</th>
            <th className="text-left px-4 py-2.5">Players</th>
            <th className="text-left px-4 py-2.5">Date</th>
            {isAdmin && <th className="px-4 py-2.5" />}
          </tr>
        </thead>
        <tbody className="divide-y divide-line/80">
          {previousGames.map((room) => (
            <tr key={room.id} className="hover:bg-input/40 transition-colors">
              <td className="px-4 py-2.5">
                {room.status === "COMPLETED" && room.match ? (
                  <Link
                    href={`/lounge/games/${room.id}`}
                    className="text-blue-400 hover:text-blue-300 underline underline-offset-2"
                  >
                    {room.label}
                  </Link>
                ) : (
                  room.label
                )}
              </td>
              <td className="px-4 py-2.5">{room.host.name}</td>
              <td className="px-4 py-2.5 text-muted">
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
              <td className="px-4 py-2.5 text-muted">{room.createdAt.toLocaleDateString()}</td>
              {isAdmin && (
                <td className="px-4 py-2.5 text-right">
                  <DeleteGameButton roomId={room.id} />
                </td>
              )}
            </tr>
          ))}
          {previousGames.length === 0 && (
            <tr>
              <td colSpan={isAdmin ? 6 : 5} className="px-4 py-6 text-center text-muted">
                No games played yet
              </td>
            </tr>
          )}
        </tbody>
      </table>
    </div>
  );
}
