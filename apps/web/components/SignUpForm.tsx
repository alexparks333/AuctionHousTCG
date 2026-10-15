"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { isSupabaseConfigured } from "@/lib/supabase/is-configured";
import { useUsernameAvailability } from "@/hooks/useUsernameAvailability";
import GoogleSignInButton from "./GoogleSignInButton";
import { TERMS_VERSION } from "@/lib/agreements";

export default function SignUpForm() {
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [agreed, setAgreed] = useState(false);
  const [status, setStatus] = useState<"idle" | "loading" | "sent" | "error">("idle");
  const [error, setError] = useState("");
  const usernameStatus = useUsernameAvailability(username);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError("");

    if (usernameStatus !== "available") {
      setError("Choose an available username before continuing.");
      setStatus("error");
      return;
    }

    if (!agreed) {
      setError("Please agree to the Terms of Service and Privacy Policy to continue.");
      setStatus("error");
      return;
    }

    setStatus("loading");

    if (!isSupabaseConfigured()) {
      setError(
        "Supabase isn't configured yet — set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY in apps/web/.env.local.",
      );
      setStatus("error");
      return;
    }

    const supabase = createClient();
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: {
        emailRedirectTo: `${window.location.origin}/login`,
        // accepted_terms_version is recorded by the signup trigger as this
        // account's acceptance of the Terms (migration 0065).
        data: { username, accepted_terms_version: TERMS_VERSION },
      },
    });

    if (error) {
      setError(error.message);
      setStatus("error");
      return;
    }
    setStatus("sent");
  }

  return (
    <>
      <div className="mt-6">
        <GoogleSignInButton />
        <p className="mt-2 text-center text-xs text-gray-400">
          Signing up with Google? You&apos;ll be asked to accept the Terms next.
        </p>
      </div>

      {status === "sent" ? (
        <div className="mt-4 rounded-xl border border-brand-border bg-white p-5 text-sm text-gray-700">
          Check <strong>{email}</strong> for a confirmation link to finish creating your account.
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-4">
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Username
            <input
              type="text"
              required
              minLength={3}
              maxLength={20}
              pattern="[a-zA-Z0-9_]+"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
              placeholder="How other buyers/sellers will see you"
            />
            {usernameStatus === "checking" && (
              <span className="text-xs text-gray-500">Checking availability…</span>
            )}
            {usernameStatus === "taken" && (
              <span className="text-xs text-brand-urgent">That username is taken.</span>
            )}
            {usernameStatus === "invalid" && username.length > 0 && (
              <span className="text-xs text-brand-urgent">
                3-20 letters, numbers, or underscores.
              </span>
            )}
            {usernameStatus === "available" && (
              <span className="text-xs text-green-600">Username is available.</span>
            )}
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Email
            <input
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
              placeholder="you@example.com"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-sm font-medium text-gray-700">
            Password
            <input
              type="password"
              required
              minLength={8}
              autoComplete="new-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="rounded-lg border border-brand-border px-3 py-2 text-sm outline-none focus:border-brand-navy"
              placeholder="At least 8 characters"
            />
          </label>

          <label className="flex items-start gap-2.5 text-sm text-gray-600">
            <input
              type="checkbox"
              required
              checked={agreed}
              onChange={(e) => setAgreed(e.target.checked)}
              className="mt-0.5 h-4 w-4 shrink-0 rounded border-gray-300 accent-brand-navy"
            />
            <span>
              I&apos;m at least 18 and I agree to the{" "}
              <Link href="/terms" target="_blank" className="font-medium text-brand-navy underline">
                Terms of Service
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank" className="font-medium text-brand-navy underline">
                Privacy Policy
              </Link>
              .
            </span>
          </label>

          {error && <p className="text-sm text-brand-urgent">{error}</p>}

          <button
            type="submit"
            disabled={status === "loading" || usernameStatus !== "available" || !agreed}
            className="mt-2 rounded-full bg-brand-gold px-4 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-brand-gold-light disabled:opacity-60"
          >
            {status === "loading" ? "Creating account..." : "Create account"}
          </button>
        </form>
      )}

      <p className="mt-6 text-center text-sm text-gray-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-navy hover:underline">
          Sign in
        </Link>
      </p>
    </>
  );
}
