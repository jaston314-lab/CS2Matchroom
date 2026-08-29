import Link from "next/link";
import { requireRole } from "@/lib/auth";
import { db } from "@/lib/db";
import { cancelMatchAction } from "@/app/dashboard/actions";

export default async function AdminRoomsPage() {
  await requireRole(["ADMIN"]);
  const rooms = await db.room.findMany({
    include: { host: true, _count: { select: { players: true } } },
    orderBy: { createdAt: "desc" },
  });

  return (
    <div className="space-y-4">
      <h1 className="text-2xl font-semibold">All matches</h1>
      <p className="text-sm text-neutral-500">
        Only one match runs at a time now — this is just the history. The active one (if any) is
        managed from the dashboard.
      </p>
      <div className="overflow-x-auto rounded-xl border border-neutral-800">
        <table className="w-full text-sm">
          <thead className="bg-neutral-900/70 text-neutral-400">
            <tr>
              <th className="text-left px-4 py-2.5">Match</th>
              <th className="text-left px-4 py-2.5">Host</th>
              <th className="text-left px-4 py-2.5">Status</th>
              <th className="text-left px-4 py-2.5">Players</th>
              <th className="text-left px-4 py-2.5">Created</th>
              <th className="text-left px-4 py-2.5" />
            </tr>
          </thead>
          <tbody className="divide-y divide-neutral-800/80">
            {rooms.map((room) => {
              const isActive = room.status !== "COMPLETED" && room.status !== "CANCELLED";
              return (
                <tr key={room.id} className="hover:bg-neutral-900/40 transition-colors">
                  <td className="px-4 py-2.5">
                    {isActive ? (
                      <Link href="/dashboard" className="text-blue-400 hover:text-blue-300">
                        {room.label}
                      </Link>
                    ) : (
                      room.label
                    )}
                  </td>
                  <td className="px-4 py-2.5">{room.host.name}</td>
                  <td className="px-4 py-2.5">{room.status}</td>
                  <td className="px-4 py-2.5">{room._count.players}</td>
                  <td className="px-4 py-2.5 text-neutral-400">{room.createdAt.toLocaleString()}</td>
                  <td className="px-4 py-2.5">
                    {isActive && (
                      <form action={cancelMatchAction}>
                        <button className="text-xs rounded-lg border border-red-900 text-red-300 px-2 py-1 hover:border-red-700 transition-colors">
                          Force-cancel
                        </button>
                      </form>
                    )}
                  </td>
                </tr>
              );
            })}
            {rooms.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-6 text-center text-neutral-500">
                  No matches yet
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
