"use client";

import { useEffect, useRef, useState } from "react";
import QRCode from "react-qr-code";
import { ChevronRight, Smartphone } from "lucide-react";
import { createPhotoUploadSession, getPhotoUploadSessionPhotosClient } from "@/lib/api";

// Matches MessagesApp.tsx's OPEN_THREAD_POLL_MS — this panel only polls
// while it's actually visible/expanded, the same "actively watched" case,
// not the slower passive-list tier.
const POLL_MS = 4000;

export default function PhoneUploadPanel({
  onPhotosFound,
}: {
  onPhotosFound: (urls: string[]) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [session, setSession] = useState<{ id: string; expiresAt: string } | null>(null);
  const [error, setError] = useState("");
  // Guards a poll response that lands after the panel's been collapsed (and
  // the session cleared) — same stale-response guard MessagesApp.tsx uses
  // for its open-thread poll.
  const sessionIdRef = useRef<string | null>(null);

  async function handleExpand() {
    setExpanded(true);
    if (session) return;
    try {
      const s = await createPhotoUploadSession();
      setSession(s);
      sessionIdRef.current = s.id;
    } catch {
      setError("Couldn't start a phone upload session — try again.");
    }
  }

  function handleCollapse() {
    setExpanded(false);
    setSession(null);
    sessionIdRef.current = null;
  }

  useEffect(() => {
    if (!expanded || !session) return;
    const id = setInterval(async () => {
      try {
        const urls = await getPhotoUploadSessionPhotosClient(session.id);
        if (sessionIdRef.current === session.id) onPhotosFound(urls);
      } catch {
        // Best-effort, same as MessagesApp.tsx's polling — a missed poll
        // just gets retried next interval.
      }
    }, POLL_MS);
    return () => clearInterval(id);
    // onPhotosFound is Step2Photos's setPhonePhotos passed straight through
    // (a stable setState reference, never an inline wrapper), so including
    // it here is safe and doesn't churn the interval on every render.
  }, [expanded, session, onPhotosFound]);

  if (!expanded) {
    return (
      <button
        type="button"
        onClick={handleExpand}
        className="group flex w-full items-center gap-3 rounded-2xl border border-gray-200 p-3.5 text-left transition-colors hover:border-brand-navy/30 hover:bg-brand-surface"
      >
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-brand-navy/5 text-brand-navy">
          <Smartphone size={18} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-gray-900">Use your phone&apos;s camera</span>
          <span className="block text-xs text-gray-500">Scan a QR code — photos show up here as you take them</span>
        </span>
        <ChevronRight size={18} className="text-gray-400 transition-transform group-hover:translate-x-0.5" />
      </button>
    );
  }

  // Safe to read window here (no SSR/hydration mismatch risk): session is
  // only ever set from handleExpand, a client-only click handler, so this
  // line never runs during server rendering.
  const qrUrl = session ? `${window.location.origin}/sell/phone-upload/${session.id}` : "";

  return (
    <div className="flex flex-col items-center gap-3 rounded-2xl border border-gray-200 bg-gradient-to-b from-brand-surface to-white p-6 text-center">
      {error && <p className="text-xs text-brand-urgent">{error}</p>}
      {qrUrl && (
        <>
          <div className="rounded-xl bg-white p-3 shadow-sm">
            <QRCode value={qrUrl} size={160} />
          </div>
          <p className="max-w-xs text-xs text-gray-500">
            Scan with your phone&rsquo;s camera app, take photos there — they&rsquo;ll show up here
            automatically, no login needed.
          </p>
        </>
      )}
      <button
        type="button"
        onClick={handleCollapse}
        className="text-xs font-semibold text-gray-500 underline-offset-2 hover:underline"
      >
        Hide
      </button>
    </div>
  );
}
