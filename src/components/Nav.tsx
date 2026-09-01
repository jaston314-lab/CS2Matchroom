import Link from "next/link";
import { getCurrentUser } from "@/lib/auth";
import { NavLinks } from "./NavLinks";

export async function Nav() {
  const user = await getCurrentUser();

  return (
    <header className="sticky top-0 z-10 border-b border-neutral-800/80 bg-black/60 backdrop-blur supports-[backdrop-filter]:bg-black/40">
      <div className="max-w-[1600px] mx-auto px-4 h-14 flex items-center justify-between">
        <Link
          href={user ? "/matchroom" : "/login"}
          className="font-semibold tracking-tight text-[15px] shrink-0"
        >
          <span className="text-blue-500">CS2</span> Matchroom
        </Link>

        <NavLinks user={user ? { name: user.name, avatarUrl: user.avatarUrl, role: user.role } : null} />
      </div>
    </header>
  );
}
