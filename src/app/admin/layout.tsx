import Link from "next/link";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["ADMIN"]);

  return (
    <div className="space-y-6">
      <nav className="flex gap-4 text-sm border-b border-neutral-800 pb-3">
        <Link href="/admin/users" className="text-neutral-300 hover:text-white">
          Users
        </Link>
        <Link href="/admin/rooms" className="text-neutral-300 hover:text-white">
          Rooms
        </Link>
        <Link href="/admin/server" className="text-neutral-300 hover:text-white">
          Server config
        </Link>
      </nav>
      {children}
    </div>
  );
}
