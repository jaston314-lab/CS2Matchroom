"use client";

import { useState } from "react";
import Link from "next/link";

interface NavUser {
  name: string;
  avatarUrl: string | null;
  role: string;
}

/**
 * The nav's interactive part — needs client state for the mobile hamburger
 * toggle, so it's split out from the server-rendered Nav shell. Renders
 * the exact same links twice: a plain horizontal row above `sm:`, and a
 * dropdown panel below it. Only one is ever visible at a time (CSS-only
 * switch), so there's no duplicate-content/SEO concern.
 */
export function NavLinks({ user }: { user: NavUser | null }) {
  const [open, setOpen] = useState(false);

  if (!user) {
    return (
      <Link
        href="/login"
        className="rounded-lg bg-blue-600 hover:bg-blue-500 px-3.5 py-1.5 font-medium text-white text-sm transition-colors"
      >
        Sign in
      </Link>
    );
  }

  const links = (
    <>
      <Link
        href="/matchroom"
        onClick={() => setOpen(false)}
        className="text-neutral-300 hover:text-white transition-colors"
      >
        Matchroom
      </Link>
      <Link
        href="/lounge"
        onClick={() => setOpen(false)}
        className="text-neutral-300 hover:text-white transition-colors"
      >
        Players Lounge
      </Link>
      {user.role === "ADMIN" && (
        <Link
          href="/admin/users"
          onClick={() => setOpen(false)}
          className="text-neutral-300 hover:text-white transition-colors"
        >
          Admin
        </Link>
      )}
      <Link
        href="/profile"
        onClick={() => setOpen(false)}
        className="flex items-center gap-2 text-neutral-300 hover:text-white transition-colors"
      >
        {user.avatarUrl && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={user.avatarUrl} alt="" className="w-6 h-6 rounded-full ring-1 ring-neutral-700" />
        )}
        {user.name}
      </Link>
      <form action="/api/auth/logout" method="POST">
        <button type="submit" className="text-neutral-500 hover:text-white transition-colors cursor-pointer">
          Sign out
        </button>
      </form>
    </>
  );

  return (
    <>
      {/* Desktop: plain horizontal row */}
      <nav className="hidden sm:flex items-center gap-5 text-sm">{links}</nav>

      {/* Mobile: hamburger + dropdown, so a handful of nav items never has
          to squeeze into (or wrap awkwardly within) a narrow header row. */}
      <div className="sm:hidden relative">
        <button
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? "Close menu" : "Open menu"}
          aria-expanded={open}
          className="flex items-center justify-center w-9 h-9 rounded-lg border border-neutral-700 text-neutral-300 hover:border-blue-500 hover:text-white transition-colors"
        >
          {open ? "✕" : "☰"}
        </button>
        {open && (
          <>
            {/* Full-screen tap-to-close backdrop, behind the panel */}
            <div className="fixed inset-0 z-10" onClick={() => setOpen(false)} aria-hidden="true" />
            <nav className="absolute right-0 top-12 z-20 w-56 rounded-xl border border-neutral-800 bg-neutral-950 shadow-xl p-3 flex flex-col gap-3 text-sm">
              {links}
            </nav>
          </>
        )}
      </div>
    </>
  );
}
