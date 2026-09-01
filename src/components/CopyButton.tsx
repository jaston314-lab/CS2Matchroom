"use client";

import { useState } from "react";

export function CopyButton({ text, label = "Copy" }: { text: string; label?: string }) {
  const [copied, setCopied] = useState(false);

  async function handleClick() {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Clipboard API can fail (permissions, non-HTTPS context) — no harm,
      // the text is still visible to select and copy by hand.
    }
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="rounded-lg border border-neutral-700 px-3 py-1.5 text-xs hover:border-blue-500 transition-colors shrink-0"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
