"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, Trash2, X } from "lucide-react";
import { ApiError, deleteMyAccount, getAccountDeletionBlockers } from "@/lib/api";
import { createClient } from "@/lib/supabase/client";

const CONFIRM_WORD = "DELETE";

const REMOVED = [
  "Your email, username, bio and phone number",
  "Your saved shipping address",
  "Unsold listings and your Singles Shop stock",
  "Your watchlist, notifications and pending offers",
  "Your login — you won't be able to sign in again",
];

const KEPT = [
  "Past orders, shown to the other party as “Deleted user”",
  "Reviews and messages you've already sent",
  "Records we must keep for taxes, payments and fraud prevention",
];

// The "Delete account" panel at the bottom of Account Settings. Collapsed by
// default; opening it checks for anything that has to finish first (open
// orders, live bids…) before offering the type-to-confirm step.
export default function DeleteAccountSection() {
  const [open, setOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const [blockers, setBlockers] = useState<string[] | null>(null);
  const [typed, setTyped] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function start() {
    setOpen(true);
    setError(null);
    setChecking(true);
    try {
      setBlockers(await getAccountDeletionBlockers());
    } catch {
      setError("Account deletion isn't available right now. Please contact support.");
    } finally {
      setChecking(false);
    }
  }

  function close() {
    setOpen(false);
    setTyped("");
    setBlockers(null);
    setError(null);
  }

  async function confirmDelete() {
    setDeleting(true);
    setError(null);
    try {
      await deleteMyAccount();
      // The login no longer exists server-side, so only clear the local
      // session, then do a full page load so nothing cached survives.
      await createClient().auth.signOut({ scope: "local" });
      window.location.assign("/account-deleted");
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) {
        try {
          setBlockers((JSON.parse(e.message) as { blockers: string[] }).blockers);
        } catch {
          setError("Something still needs to finish before you can delete your account.");
        }
      } else {
        setError("We couldn't delete your account. Please try again.");
      }
      setDeleting(false);
    }
  }

  const blocked = blockers !== null && blockers.length > 0;
  const ready = blockers !== null && blockers.length === 0;

  return (
    <section className="rounded-xl border border-red-200 bg-white p-5 lg:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-red-50 text-red-600">
            <Trash2 size={15} />
          </span>
          <div>
            <h2 className="text-sm font-semibold text-gray-900">Delete account</h2>
            <p className="text-sm text-gray-500">Permanently delete your account and personal data.</p>
          </div>
        </div>
        {!open && (
          <button
            type="button"
            onClick={start}
            className="rounded-full border border-red-200 px-4 py-2 text-sm font-semibold text-red-600 transition-colors hover:bg-red-50"
          >
            Delete my account…
          </button>
        )}
      </div>

      {open && (
        <div className="mt-5 animate-step-enter border-t border-red-100 pt-5">
          {checking && (
            <p className="flex items-center gap-2 text-sm text-gray-500">
              <Loader2 size={15} className="animate-spin" /> Checking your account…
            </p>
          )}

          {blocked && (
            <div className="rounded-xl bg-amber-50 p-4 ring-1 ring-amber-200">
              <p className="flex items-center gap-2 text-sm font-semibold text-amber-900">
                <AlertTriangle size={15} /> Finish these first
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-6 text-sm text-amber-900/80">
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
              <p className="mt-3 text-xs text-amber-900/70">
                Once everything above is completed, come back here to delete your account.
              </p>
            </div>
          )}

          {ready && (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="rounded-xl bg-red-50/60 p-4 ring-1 ring-red-100">
                  <p className="text-xs font-semibold uppercase tracking-wider text-red-700">Deleted</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
                    {REMOVED.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <X size={14} className="mt-0.5 shrink-0 text-red-500" /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
                <div className="rounded-xl bg-brand-surface p-4 ring-1 ring-brand-border">
                  <p className="text-xs font-semibold uppercase tracking-wider text-gray-500">Kept</p>
                  <ul className="mt-2 space-y-1.5 text-sm text-gray-700">
                    {KEPT.map((item) => (
                      <li key={item} className="flex items-start gap-2">
                        <Check size={14} className="mt-0.5 shrink-0 text-gray-400" /> {item}
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              <p className="mt-4 text-sm text-gray-600">
                If you sell here, withdraw any remaining balance from <span className="font-semibold">Withdraw</span>{" "}
                first — your Stripe account stays yours, but you won&apos;t be able to reach it from AuctionHous
                afterwards.
              </p>

              <label className="mt-4 block text-sm font-semibold text-gray-800">
                Type <span className="font-mono text-red-600">{CONFIRM_WORD}</span> to confirm
                <input
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  autoComplete="off"
                  className="mt-1.5 block w-full max-w-xs rounded-xl border border-gray-200 bg-gray-50 px-3.5 py-2.5 font-mono text-sm outline-none transition focus:border-red-300 focus:bg-white focus:ring-4 focus:ring-red-100"
                />
              </label>
            </>
          )}

          {error && <p className="mt-4 text-sm text-red-600">{error}</p>}

          <div className="mt-5 flex flex-wrap gap-3">
            {ready && (
              <button
                type="button"
                onClick={confirmDelete}
                disabled={typed !== CONFIRM_WORD || deleting}
                className="inline-flex items-center gap-2 rounded-full bg-red-600 px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-red-700 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {deleting ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                {deleting ? "Deleting…" : "Permanently delete account"}
              </button>
            )}
            <button
              type="button"
              onClick={close}
              disabled={deleting}
              className="rounded-full border border-brand-border px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-brand-surface"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
