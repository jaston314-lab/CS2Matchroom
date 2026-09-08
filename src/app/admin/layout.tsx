import Link from "next/link";
import { requireRole } from "@/lib/auth";

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  await requireRole(["ADMIN"]);

  return (
    <div className="space-y-6">
      <nav className="flex gap-5 text-sm border-b border-line pb-3">
        <Link href="/admin/users" className="text-ink hover:text-blue-400 transition-colors">
          Users
        </Link>
        <Link href="/admin/server" className="text-ink hover:text-blue-400 transition-colors">
          Server config
        </Link>
      </nav>
      {children}
    </div>
  );
}
