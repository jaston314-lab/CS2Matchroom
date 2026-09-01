import Link from "next/link";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["ADMIN"]);

  return (
    <div className="space-y-6">
      <nav className="flex gap-5 text-sm border-b border-neutral-800 pb-3">
        <Link href="/admin/users" className="text-neutral-300 hover:text-blue-400 transition-colors">
          Users
        </Link>
        <Link href="/admin/server" className="text-neutral-300 hover:text-blue-400 transition-colors">
          Server config
        </Link>
      </nav>
      {children}
    </div>
  );
}
