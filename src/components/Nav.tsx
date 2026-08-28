import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export async function Nav() {
  const user = await getCurrentUser();

  return (
    <header className="border-b border-neutral-800 bg-neutral-900">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link href={user ? "/dashboard" : "/"} className="font-semibold tracking-tight">
          CS2 Matchroom
        </Link>

        <nav className="flex items-center gap-4 text-sm">
          {user ? (
            <>
              <Link href="/dashboard" className="text-neutral-300 hover:text-white">
                Dashboard
              </Link>
              {(user.role === "HOST" || user.role === "ADMIN") && (
                <Link href="/room/new" className="text-neutral-300 hover:text-white">
                  New Room
                </Link>
              )}
              {user.role === "ADMIN" && (
                <Link href="/admin/users" className="text-neutral-300 hover:text-white">
                  Admin
                </Link>
              )}
              <Link href="/profile" className="text-neutral-300 hover:text-white">
                {user.name}
              </Link>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-neutral-400 hover:text-white cursor-pointer"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/api/auth/steam/login"
              className="rounded bg-blue-600 hover:bg-blue-500 px-3 py-1.5 text-white"
            >
              Sign in through Steam
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
