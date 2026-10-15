import Avatar from "@/components/Avatar";
import type { MessageThreadSummary } from "@/lib/api";
import { formatRelativeTime } from "@/lib/format";

export default function ThreadListItem({
  thread,
  active,
  onSelect,
}: {
  thread: MessageThreadSummary;
  active: boolean;
  onSelect: () => void;
}) {
  const name = thread.counterpart.username ?? "Deleted user";

  return (
    <button
      type="button"
      onClick={onSelect}
      className={`relative flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-all ${
        active
          ? "bg-white shadow-sm ring-1 ring-brand-border"
          : "hover:bg-white/70"
      }`}
    >
      {active && <span aria-hidden className="absolute inset-y-3 left-0 w-1 rounded-full bg-brand-gold" />}
      <span className="relative shrink-0">
        <Avatar label={name} size={40} />
        {thread.unread && (
          <span className="absolute -right-0.5 -top-0.5 h-3 w-3 rounded-full bg-brand-gold ring-2 ring-white" />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <p
            className={`truncate text-sm ${
              thread.unread ? "font-semibold text-gray-900" : "font-medium text-gray-700"
            }`}
          >
            {name}
          </p>
          {/* Date.now()-based text — the same instant can legitimately
              round differently between the server's render and the
              client's hydration a moment later ("just now" -> "1m ago"),
              same reasoning as AuctionPriceBox's own countdown suppression.
              Not a real mismatch, just clock skew. */}
          <span className="shrink-0 text-xs text-gray-400" suppressHydrationWarning>
            {formatRelativeTime(thread.lastMessageAt)}
          </span>
        </div>
        <div className="mt-1 flex items-center gap-1.5">
          {thread.lastMessageKind === "offer" ? (
            <>
              {/* Received (gold) vs sent (navy/blue) mirrors the same two
                  brand colors used everywhere else an offer's direction
                  matters (e.g. the Accepted/Pending badges) — solid fill
                  here rather than the usual light-tint pill, so it reads
                  as a real status flag at inbox-row glance size. */}
              <span
                className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-bold text-white ${
                  thread.lastMessageIsMine ? "bg-brand-navy" : "bg-brand-gold"
                }`}
              >
                {thread.lastMessageIsMine ? "Sent an Offer" : "Received an Offer"}
              </span>
              {/* The body itself is always written "Sent an offer: $X on
                  Y" (from the buyer's own point of view, regardless of who
                  ends up viewing it) — the badge above already says
                  which direction, so only the amount/listing half after
                  that fixed prefix needs to show here. */}
              <p className={`min-w-0 truncate text-sm ${thread.unread ? "text-gray-800" : "text-gray-500"}`}>
                {thread.lastMessageBody.replace(/^Sent an offer:\s*/i, "")}
              </p>
            </>
          ) : (
            <p className={`truncate text-sm ${thread.unread ? "text-gray-800" : "text-gray-500"}`}>
              {thread.lastMessageIsMine && <span className="text-gray-400">You: </span>}
              {thread.lastMessageBody}
            </p>
          )}
        </div>
      </div>
    </button>
  );
}
