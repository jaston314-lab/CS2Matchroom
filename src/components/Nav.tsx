import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { NavLinks } from "./NavLinks";

export async function Nav() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-10 bg-header border-b border-line py-3 px-4 sm:px-6">
      <div className="max-w-[1600px] mx-auto flex items-center justify-between">
        <Link
          href={user ? "/matchroom" : "/login"}
          className="text-xl font-bold tracking-tight text-white shrink-0"
        >
          CS2 MATCHROOM
        </Link>

        <NavLinks user={user ? { name: user.name, avatarUrl: user.avatarUrl, role: user.role } : null} />
      </div>
    </header>
  );
}
