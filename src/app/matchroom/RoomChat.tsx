"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { sendChatMessageAction } from "./actions";

export interface ChatMessageRow {
  id: string;
  body: string;
  createdAt: string;
  userId: string;
  userName: string;
  userAvatarUrl: string | null;
}

// A handful of distinct, readable-on-dark colors — picked per user from a
// hash of their id, so the same person always gets the same color across
// messages/reloads without storing anything extra.
const NAME_COLORS = [
  "text-sky-400",
  "text-emerald-400",
  "text-amber-400",
  "text-fuchsia-400",
  "text-rose-400",
  "text-violet-400",
  "text-cyan-400",
  "text-lime-400",
];

function colorFor(userId: string): string {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) hash = (hash * 31 + userId.charCodeAt(i)) | 0;
  return NAME_COLORS[Math.abs(hash) % NAME_COLORS.length];
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

export function RoomChat({
  messages,
  currentUserId,
}: {
  messages: ChatMessageRow[];
  currentUserId: string;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);
  const lastCountRef = useRef(messages.length);

  // Only auto-scroll when new messages actually arrived (not on every
  // AutoRefresh tick, which re-renders this with the same list) — otherwise
  // scrolling up to read history would keep getting yanked back down.
  useEffect(() => {
    if (messages.length !== lastCountRef.current && listRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
    }
    lastCountRef.current = messages.length;
  }, [messages.length]);

  async function handleSend() {
    const body = draft.trim();
    if (!body || sending) return;
    setSending(true);
    setDraft("");
    try {
      await sendChatMessageAction(body);
      router.refresh();
    } catch (err) {
      console.error("Failed to send chat message:", err);
      setDraft(body); // give it back so nothing's lost
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="panel p-4 flex flex-col h-52">
      <h2 className="text-sm font-bold text-white mb-1.5">Match Chat</h2>
      <div ref={listRef} className="flex-1 overflow-y-auto mb-2 space-y-1 text-sm leading-relaxed pr-2">
        {messages.length === 0 && (
          <p className="text-muted text-center py-6">No messages yet — say hi to the lobby.</p>
        )}
        {messages.map((m) => (
          <p key={m.id} className={m.userId === currentUserId ? "bg-blue-500/5 -mx-1.5 px-1.5 rounded" : undefined}>
            <span className={`font-medium ${colorFor(m.userId)}`}>{m.userName}:</span>{" "}
            <span className="text-ink">{m.body}</span>{" "}
            <span className="text-[11px] text-muted/70 tabular-nums">{formatTime(m.createdAt)}</span>
          </p>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              void handleSend();
            }
          }}
          maxLength={500}
          placeholder="Input a message..."
          className="flex-1 min-w-0 bg-input border border-line rounded-lg px-4 py-2.5 text-sm text-ink focus:outline focus:outline-1 focus:outline-blue-500"
        />
        <button
          type="button"
          onClick={() => void handleSend()}
          disabled={sending || !draft.trim()}
          className="shrink-0 rounded-lg bg-accent-blue hover:bg-accent-blue-hover disabled:opacity-40 disabled:hover:bg-accent-blue px-4 py-2.5 text-sm font-medium text-white transition-colors"
        >
          Send
        </button>
      </div>
    </div>
  );
}
