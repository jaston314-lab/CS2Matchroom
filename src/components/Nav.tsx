import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";

export async function Nav() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-800/80 bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/40">
      <div className="max-w-5xl mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href={user ? "/dashboard" : "/login"}
          className="font-semibold tracking-tight text-[15px]"
        >
          <span className="text-blue-500">CS2</span> Matchroom
        </Link>

        <nav className="flex items-center gap-5 text-sm">
          {user ? (
            <>
              <Link href="/dashboard" className="text-neutral-300 hover:text-white transition-colors">
                Dashboard
              </Link>
              <Link href="/lounge" className="text-neutral-300 hover:text-white transition-colors">
                Players Lounge
              </Link>
              {user.role === "ADMIN" && (
                <Link href="/admin/users" className="text-neutral-300 hover:text-white transition-colors">
                  Admin
                </Link>
              )}
              <Link
                href="/profile"
                className="flex items-center gap-2 text-neutral-300 hover:text-white transition-colors"
              >
                {user.avatarUrl && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full ring-1 ring-neutral-700" />
                )}
                {user.name}
              </Link>
              <form action="/api/auth/logout" method="POST">
                <button
                  type="submit"
                  className="text-neutral-500 hover:text-white transition-colors cursor-pointer"
                >
                  Sign out
                </button>
              </form>
            </>
          ) : (
            <Link
              href="/login"
              className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 font-medium text-white transition-colors"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
