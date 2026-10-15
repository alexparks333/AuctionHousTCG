# KYC & Chargeback-Fraud Ban System ("Plan B")

**Status:** built and live, verified end-to-end with real Twilio SMS, a real Resend
email, and a real Stripe Identity session. This doc is the setup/runbook + reference
for the whole system — the account-ban mechanic, the checkout-time fraud
acknowledgment, the payment-fingerprint ban-evasion check, the 3-level KYC ladder that
gates purchase size, and the identity-hash/phone-number ban-evasion detection that
closes the gap the ladder alone left open (§4). See CLAUDE.md §7 for the
money-transmitter/legal context this was built to address; this doc is the "how it
actually works and how to run it" piece.

---

## 1. Why this exists

CSFloat-style deterrence, adapted for cards: a buyer who receives an item and reverses
the charge through their bank instead of filing a claim is permanently banned — because
every real dispute should go through our own claims system (`internal/dispute`), where
it can actually be adjudicated on evidence, not straight to the bank where we have no
voice at all.

The ban alone doesn't stop someone from just signing up again under a new email, so
three more pieces exist specifically to raise the cost of evasion:

- **A 3-level KYC ladder** that caps purchase size until a buyer proves they're a real,
  distinct person (phone + email, then government ID, then a verified bank account).
- **Payment-fingerprint blocking** — a banned account's card/bank fingerprint is
  remembered, so reusing the *same physical card* on a brand-new account is blocked too.
- **Ban-evasion detection (§4)** — the KYC ladder alone only proves "this account
  belongs to a real, distinct-feeling person," not "this isn't the same person who was
  already banned." A one-way fingerprint of the verified identity data (never the raw
  SSN) and a phone-number reuse check both close that specific gap.

---

## 2. The ban itself

- **Trigger:** any real Stripe chargeback filed at all — `internal/chargeback.RecordCreated`
  (fires on `charge.dispute.created`), independent of the dispute's eventual outcome.
  Not "lost," not "delivered or not" — going around the claims system to the bank is
  itself the violation.
- **Mechanism:** a permanent row in `account_suspensions` (`reason = 'chargeback_fraud'`,
  `ends_at = 'infinity'`) — the same table Plan A's ship-deadline strikes use, just a
  different reason and no expiry.
- **Enforcement:** `internal/platform/ban.go`'s `WithBanGuard` middleware wraps the
  entire mux in `cmd/api/main.go` — every non-GET request from a banned user gets a
  403 before it ever reaches routing. GET requests always pass, which is what lets a
  banned user still log in and see their own account.
- **Visibility:** `IsBanned`/`BannedAt` are on both `GET /me` and public
  `GET /users/{username}` (derived live from `account_suspensions`, never a stored
  flag). `components/AccountBannedBanner.tsx` renders it both on the banned user's own
  header (`Header.tsx`) and on their public seller profile
  (`app/seller/[username]/page.tsx`) for anyone else viewing it.
- **Checkout acknowledgment:** `ShippingAddressGate.tsx` has a required second checkbox
  ("if I reverse this through my bank instead of filing a claim, I will be banned")
  alongside the address-confirmation one. The backend independently rejects Buy It Now
  with 400 if `fraudPolicyAcknowledged` isn't sent (`buynow.go`'s `HandleBuyNow`) — the
  UI checkbox is not the actual enforcement.

---

## 3. Payment-fingerprint ban evasion

Stripe's own card/bank-account fingerprint (stable across different Stripe customers
using the same physical card) is stamped onto `orders.buyer_payment_fingerprint` at
capture time. Two checks:

- **Pre-charge** (`internal/auction/checkout.go`, `blockedByBannedFingerprint`) — for a
  *saved* card/bank, the fingerprint is already known before any money moves. Blocks
  creating a checkout intent at all if that fingerprint belongs to a banned account.
- **Post-capture** (`internal/auction/buynow.go`, `checkFraudAndStampOrder`) — a
  brand-new card's fingerprint isn't knowable until after Stripe processes it. If it
  matches a banned account after the fact, the charge is immediately refunded and the
  order cancelled rather than left standing.

A real, accepted limitation: a brand-new card can never be blocked *before* the very
first charge on it, only reversed immediately after.

---

## 4. Ban-evasion detection — identity-hash and phone-number reuse

**The real gap this closes:** as originally built, the KYC ladder proved "this is a
real, distinct-feeling account" — but stored nothing that let us tell if the *same
person* (same phone number, or same verified government ID) was already banned under a
different account. A banned user could re-verify their real phone number, or go
through Stripe Identity again with their own real ID, on a brand-new account, and
nothing would notice. Only the payment-fingerprint check (§3) actually linked accounts
together, and only for a reused *card*, not a reused *identity*.

### Identity-hash reuse (`internal/webhook.recordIdentityVerified`)

Stripe Identity's own webhook payload includes `VerifiedOutputs` — the real verified ID
number (SSN, in the US) and date of birth — but the original build threw all of that
away, storing only a bare `identity_verified_at` timestamp. Now:

1. `identityFingerprint(hmacKey, vo)` computes **`HMAC-SHA256(idNumber + "|" + dob,
   IDENTITY_FINGERPRINT_HMAC_KEY)`** — **never a plain hash**. An SSN is only 9 digits
   (≤ ~1 billion combinations), low enough entropy that a plain SHA-256 of one is
   brute-forceable offline in seconds from a leaked table. HMAC with a
   server-side-only secret key makes that infeasible without also having the key. The
   raw SSN/ID number is never stored anywhere, only this one-way fingerprint.
2. The fingerprint is stored on `users.identity_fingerprint_hash`.
3. Immediately cross-checked: does this fingerprint already belong to a *different*,
   currently-banned user? If so, this account is banned too —
   `internal/accountban.Ban(ctx, pool, userID, accountban.ReasonBanEvasion)`.

**`IDENTITY_FINGERPRINT_HMAC_KEY` must never rotate casually** — rotating it silently
stops matching any previously-stored fingerprint against new ones, since the same
input produces a different HMAC output under a different key. Generate it once with
`openssl rand -hex 32` and treat it like any other long-lived secret.

### Phone-number reuse (`internal/phoneverify.checkPhoneReuse`)

Simpler, and needs no external service or secret key: two accounts sharing the exact
same Twilio-verified phone number *is* the signal. After `phone_verified_at` is
stamped, `checkPhoneReuse` checks whether that normalized E.164 number already belongs
to a different, currently-banned user, and bans this one too if so — same
`accountban.Ban`, same `ReasonBanEvasion`.

### `internal/accountban` — the shared ban primitive

Both detectors above (and no one else — `internal/chargeback`'s own `banBuyer` keeps
its existing, separately-tested `chargeback_fraud` insert logic untouched) call
`accountban.Ban(ctx, pool, userID, reason)`: an idempotent insert into
`account_suspensions` (`ends_at = 'infinity'`), returning whether *this* call was the
one that actually inserted the row (so callers only log once, not on every redundant
detection).

**`reason = 'ban_evasion'`**, a value distinct from `'chargeback_fraud'` — enforcement
(`WithBanGuard`, the derived `IsBanned` on `/me`/public profiles) treats both reasons
identically (permanently, everywhere), but keeping them distinct means the audit trail
can still tell "a real dispute was filed" apart from "this account was caught reusing a
banned one's own signal." Both `internal/platform/ban.go` and
`internal/user/user.go`'s `banStatusColumns` check `reason in ('chargeback_fraud',
'ban_evasion')` — **if you ever add a third ban reason, both of those queries need
updating too**, or the new reason will silently ban writes (`WithBanGuard`) without the
UI (`IsBanned`) ever reflecting it, which is exactly the kind of inconsistent state that's
easy to miss.

### Verified live (via direct DB manipulation, not a full second Stripe/Twilio round-trip)

Confirmed end-to-end against two real dev accounts: banned one, gave a second account
the *same* phone number, and confirmed (a) the reuse-detection query correctly
returns `true`, (b) the resulting `ban_evasion` row is correctly recognized by both
`WithBanGuard`'s query and the `IsBanned` derivation used by `/me` and public profiles.
All test data (the fake ban rows, the fake shared phone number) was cleaned up
afterward — **except** one real account's own previously-verified phone number, which
was overwritten during testing and had to be nulled back out rather than restored,
since the original value was never captured before being overwritten. No functional
impact (`phone_verified_at` — the actual KYC gate — was untouched), just a blank
contact-info field on that one dev account.

### What this still doesn't catch

- **A banned user with a genuinely new phone number, new email, and someone else's (or
  a synthetic) identity** — nothing here claims to solve identity fraud in general,
  only *reuse* of a signal a previously-banned account already used.
- **Device/browser fingerprinting** — a real, separate anti-fraud layer (shared
  cookies, canvas/WebGL fingerprints, IP reputation) that would catch more evasion
  patterns than phone/identity reuse alone, but is a genuinely separate project, not
  built here.
- **Stripe's own cross-platform fraud signals** (if any exist for Identity — not
  confirmed either way, would need checking against Stripe's current docs before
  relying on it).

---

## 5. The KYC ladder

| Level | Requires | Unlocks |
|---|---|---|
| 0 | Nothing beyond signup | **Cannot bid or buy at all** ($0 cap) |
| 1 | Phone **and** email verification, both | $75/item cap |
| 2 | + government ID & ID-number check (Stripe Identity) | No purchase cap |
| 3 | + a verified, linked bank account | Unlocks paying by bank (ACH) |

Derived, never stored: `internal/kyc.Level()` computes the level live from four
nullable timestamps on `users` (`phone_verified_at`, `email_verified_at`,
`identity_verified_at`, `bank_verified_at`) — same "derive from history" principle as
seller tier (CLAUDE.md §5.4).

### The rule, stated plainly: Level 0 can't buy anything at all

This isn't just a design intention — it's live, enforced code, on every purchase path
in the app, not just one of them:

- **Level 0** (hasn't completed phone *and* email verification): `MaxPurchaseCents`
  returns a **`$0` cap** — `kyc.CheckPurchase` rejects with `ErrPurchaseNotAllowed`
  before any bid or purchase can go through, full stop.
- **Level 1** (phone + email done, not yet identity-verified): capped at **$75/item**
  — anything over that rejects with `ErrExceedsPurchaseCap`.
- **Level 2+** (identity-verified): no cap.

`kyc.CheckPurchase(level, priceCents)` is called from all three places money or a bid
can move, independently:

```
internal/auction/auction.go:143   → attemptBid (placing a bid)
internal/auction/checkout.go:230  → HandleCreateCheckoutIntent (real Stripe checkout)
internal/auction/buynow.go:273    → HandleBuyNow (Buy It Now / no-Stripe mock path)
```

Each one re-derives the buyer's current level fresh at the moment of the attempt (via
`kyc.LevelForUser`) — never a cached or client-supplied value — so verifying phone +
email takes effect on the very next bid or purchase attempt, no delay. See the
`kyc.Enforce` note just below for the one condition that gates whether this actually
runs at all (it's a no-op if Twilio/Resend aren't configured, by design).

### Why Level 1 is both phone *and* email, not either alone

Every account already goes through *some* email check via Supabase Auth or Google
OAuth signup — but that's trivial to defeat (a free inbox costs nothing). A phone
number is real friction (cost, carrier ID requirements, Twilio's own abuse detection).
Neither alone was considered a strong enough signal, so Level 1 requires both — and
critically, **the email check here is a separate, purpose-built one-time code
(`internal/emailverify`), not the signup confirmation link** Supabase/Google already
sent. That link was considered too weak a factor to double as this one (a "click a
link" flow, not a "prove you can act on this inbox right now" one, unlike the phone
flow it's meant to match).

### `kyc.Enforce` — the dev/prod safety valve

`internal/kyc.Enforce` (a package-level bool, default `false`) gates whether
`CheckPurchase` does anything at all. It's only set `true` in `cmd/api/main.go` once
**both** Twilio and Resend are actually configured — if either is missing, no user
could ever reach Level 1, so enforcing the $0/$75 caps would block every purchase on
the site rather than just the ones this system exists to catch. This is why local dev
without `TWILIO_*`/`RESEND_API_KEY` set never bricks bidding/buying, and also why the
**dev quick-switch test accounts (Seller/Bidder A/Bidder B) don't need to go through
KYC** unless those env vars happen to be set.

---

## 6. Level 1a — Phone verification (Twilio Verify)

- **Backend:** `internal/phoneverify` — a thin, direct `net/http` client against
  Twilio's Verify V2 API (`POST /v2/Services/{sid}/Verifications` to start,
  `/VerificationCheck` to check), not the official Twilio Go SDK. Confirmed against
  Twilio's current API reference, not assumed.
- **`NormalizeE164`** (`phoneverify.go`) — turns a plain 10-digit US number
  (`"8188078706"`) into real E.164 (`"+18188078706"`) before it ever reaches Twilio or
  gets stored. A **real, live-found bug**: Twilio flatly rejects a bare 10-digit number
  with `Invalid parameter 'To'`. Covered by `phoneverify_test.go`.
- **Frontend:** `components/PhoneVerifyForm.tsx` (page: `app/verify/phone`) —
  live-formats input as `(818) 807-8706` as you type (`formatUSPhone`, display-only;
  the backend normalizes independently), and uses the shared `CodeInput` 6-box
  auto-advance/auto-submit component (see §8).
- **Setup:** Twilio account → **Verify → Services → Create new Service** (a Verify
  Service, `VA...`) → **API keys & auth tokens** for the Account SID (`AC...`) and Auth
  Token. All three go in `.env`:
  ```
  TWILIO_ACCOUNT_SID=AC...
  TWILIO_AUTH_TOKEN=...
  TWILIO_VERIFY_SERVICE_SID=VA...
  ```
- **Trial-account gotcha (real, hit live):** a fresh Twilio trial account can only text
  numbers added as **verified caller IDs**, or numbers get rejected with *"you must
  have an approved Primary Compliance Profile."* Two ways around it: add your own
  number as a verified caller ID (fast, free, testing-only), or complete a **Trust
  Hub Individual/Business Compliance Profile** (`BU...`, requires real identity info,
  is the actual production fix). Once approved, sending to arbitrary numbers works
  immediately — confirmed live.
- **Cost:** ~$0.058/verification in the US ($0.05 Verify fee + ~$0.0083 SMS), free
  trial credit to start, no separate monthly fee.

---

## 7. Level 1b — Email verification (custom, via Resend)

- **Backend:** `internal/emailverify` — generates a random 6-digit code
  (`crypto/rand`, not `math/rand`), stores it on `users.email_verification_code` /
  `_sent_at` (a single pending-code slot, 15-minute expiry), and mails it via
  `internal/mail.Client.SendTo`. `HandleStartVerify` reads the account's own email
  server-side — there's no email address field in the request, it's never
  client-supplied.
- **`mail.Client.SendTo`** — a second method alongside the original `Send` (which only
  ever mails the fixed claims-notification inbox, see `docs/Resend.md`). `SendTo` takes
  a per-call recipient, which is what a one-time code to an arbitrary user's own inbox
  needs. `cmd/api/main.go` constructs a *second* `mail.Client` for this
  (`ACCOUNT_EMAIL_FROM`, default `AuctionHous <noreply@auctionhous.net>`) — same
  `RESEND_API_KEY`/verified domain as the claims one, just a sender display name suited
  for account email rather than internal ops alerts.
- **Frontend:** `components/EmailVerifyForm.tsx` (page: `app/verify/email`) — no email
  input at all (always the account's own address), same shared `CodeInput` box UI.
- **Config:** only needs `RESEND_API_KEY` (already required for claims notifications,
  see `docs/Resend.md`) plus the optional `ACCOUNT_EMAIL_FROM` override.

---

## 8. `CodeInput` — the shared 6-box OTP input

`components/CodeInput.tsx`, used by both `PhoneVerifyForm` and `EmailVerifyForm`.

- Typing a digit auto-advances to the next box; backspace on an empty box steps back;
  pasting a full code fills every box at once.
- **Auto-submits the instant the 6th box fills** — no separate "Confirm" click. Calls
  `onComplete(code)` exactly once per distinct completed code (`submittedRef` guards
  against re-firing on every keystroke while correcting a digit).
- **A real bug fixed here:** the first version called `onComplete` (which triggers the
  parent form's `setBusy`) from inside `CodeInput`'s own `setDigits` functional
  updater — React disallows updating one component's state from inside another's
  updater callback ("Cannot update a component while rendering a different
  component"). Fixed by computing the next array from the closure and calling
  `maybeComplete` as a plain statement *after* `setDigits`, not nested inside it.
- Styling: `h-16 w-14` boxes, `border-2 border-gray-400` (darkened per request),
  centered via `justify-center` on the box row *and* `w-full justify-center` on its
  wrapping container in each form (a `justify-center` on a shrink-to-fit flex div does
  nothing on its own — it needs a wider parent to center *within*).

---

## 9. Level 2 — Identity verification (Stripe Identity)

- **Backend:** `internal/identity.HandleStart` calls
  `internal/payment.Client.CreateIdentityVerificationSession` — a `document`-type
  Stripe Identity session with `RequireIDNumber: true` (collects a government ID
  **and** performs an ID-number/SSN check against it). We never see or store the SSN
  or the ID image — only the session id and its eventual verified/failed outcome.
- **Async by nature:** the actual `identity_verified_at` timestamp is only ever set by
  `internal/webhook`'s `identity.verification_session.verified` case — a webhook, not
  a synchronous response to anything this app's own request handler does.
- **Frontend:** `components/IdentityVerifyButton.tsx` (page: `app/verify/identity`) —
  **opens Stripe's hosted flow in a new tab** (`window.open(url, "_blank", ...)`), not
  a same-tab redirect. **A real, live-found gap:** Stripe's own flow ends with "You may
  close this tab" — navigating the *current* tab there means there's no AuctionHous tab
  left to return to. After opening, this component shows a "Refresh status" button
  (`router.refresh()`, re-running the page's server-side `me` fetch) rather than
  polling, since there's no synchronous way to know identity verification finished —
  only the webhook knows.
- **Setup:** no separate API key — reuses `STRIPE_SECRET_KEY`. One-time manual step:
  enable **Identity** in the Stripe Dashboard (dashboard.stripe.com/identity), and make
  sure `identity.verification_session.verified` is one of the event types selected on
  your `/webhooks/stripe` endpoint (same endpoint every other Stripe webhook already
  uses — no second webhook endpoint needed).

### The `stripe listen` requirement — read this before testing Level 2 or Level 3 locally

**A real bug hit live:** completed a real Stripe Identity verification, clicked
"Refresh status" repeatedly, nothing happened. Root cause: **no `stripe listen` process
was running**, so Stripe's test-mode webhook events had nowhere local to be delivered —
Stripe's servers can't reach `localhost:8080` directly. The verification had genuinely
succeeded on Stripe's side; our backend just never heard about it.

**Local dev must have this running any time you're testing identity or bank
verification** (or chargebacks, or payment_intent webhooks — anything Stripe-webhook-driven):

```
stripe listen --forward-to localhost:8080/webhooks/stripe
```

It prints a `whsec_...` signing secret — put that in `STRIPE_WEBHOOK_SECRET` in
`.env` and restart the API. This secret is **different every time you start `stripe
listen`** unless you pin it, so re-running the listener after a restart may mean
updating `.env` again.

If you complete a verification while `stripe listen` wasn't running, the event isn't
lost — it's just sitting undelivered. Recover it without redoing the whole flow:

```
stripe events list --type identity.verification_session.verified --limit 5
stripe events resend evt_...
```

(with `stripe listen` now running, `resend` forwards it through the active listener).

---

## 10. Level 3 — Verified bank account

- **Backend:** reuses the *existing* saved-bank-account flow
  (`internal/paymentmethod.CreateBankSetupIntentSecret`, already built for "Pay by bank
  instead" at checkout) — Level 3 doesn't add a new linking mechanism, it just listens
  for the moment an existing one succeeds.
- **`bank_verified_at`** is set by `internal/webhook`'s `setup_intent.succeeded` case
  (`recordBankVerified`) — a `us_bank_account` SetupIntent only ever reaches
  `succeeded` after Stripe has actually verified the account (instantly via Financial
  Connections, or the buyer confirming two micro-deposits days later), so the event
  firing *is* the verification. Resolved back to a user via `stripe_customer_id`
  (there's no `client_reference_id` on a SetupIntent the way there is on an Identity
  session). Every *other* `setup_intent.succeeded` event (the card-saving rail uses the
  same event type) is a silent no-op here — only a `us_bank_account` one advances KYC.
- **Frontend:** `app/verify/bank/page.tsx` reuses `components/SavedBanksManager.tsx`
  directly (the same "Linked Bank Accounts" UI already in Account Settings) rather than
  building a second bank-linking form.
- Also needs `stripe listen` running locally, same as Level 2 (§9).

---

## 11. `KycSummary` — the Account Settings overview

`components/KycSummary.tsx`, rendered in `app/account/settings/page.tsx`. Deliberately
**read-only** — no input fields, just progress + links out to the dedicated `/verify/*`
pages. Displays:

- A big "Your KYC level — N / 3" badge at the top.
- **Level 1** as one card with two sub-requirements (Phone, Email) — collapses to a
  single "Verified" row once both are done, rather than leaving two redundant
  "Verified" sub-rows under a header that already says the same thing.
- **Level 2 / Level 3** as single rows, each with a numbered circle (gray outline → 
  filled green checkmark) matching Level 1's own indicator, and a "Complete Level N
  first" grey-out until the prerequisite level is done.

### `/verify` is a top-level route, not nested under `/account`

`app/verify/layout.tsx` renders just `Header` (with `showCategoryNav={false}`, a new
prop) + the page + `Footer` — deliberately **not** nested under `app/account/layout.tsx`.
Next.js layouts only ever nest/add, never let a child opt out of an ancestor's chrome —
so the only way for these single-task KYC pages to drop both the category-bubble row
*and* the account-tabs row was to live outside that layout's subtree entirely.

---

## 12. Full config reference

```
# Phone verification (internal/phoneverify) — Twilio Verify V2
TWILIO_ACCOUNT_SID=AC<...>
TWILIO_AUTH_TOKEN=<...>
TWILIO_VERIFY_SERVICE_SID=VA<...>

# Email verification (internal/emailverify) — reuses Resend
RESEND_API_KEY=re_<...>                              # already required for docs/Resend.md
ACCOUNT_EMAIL_FROM=AuctionHous <noreply@auctionhous.net>   # optional, has a default

# Identity + bank verification (internal/identity, internal/webhook) — reuses Stripe
STRIPE_SECRET_KEY=sk_test_<...>                      # no separate key needed
STRIPE_WEBHOOK_SECRET=whsec_<...>                     # from `stripe listen`, see §9

# Ban-evasion detection (internal/webhook, §4) — generate with `openssl rand -hex 32`
IDENTITY_FINGERPRINT_HMAC_KEY=<...>                   # optional but never rotate casually
```

**Local dev checklist before testing any of Level 1–3 end-to-end:**

1. `TWILIO_*` and `RESEND_API_KEY` both set (otherwise `kyc.Enforce` stays `false` and
   nothing is gated — fine for testing unrelated features, not fine for testing KYC
   itself).
2. `stripe listen --forward-to localhost:8080/webhooks/stripe` running in a terminal
   you leave open, with its printed `whsec_...` in `STRIPE_WEBHOOK_SECRET`.
3. API restarted after any `.env` change (Go doesn't hot-reload).

---

## 13. File map

**Backend**
- `internal/kyc/kyc.go` — level derivation, `CheckPurchase`, `Enforce` flag.
- `internal/phoneverify/` — Twilio Verify client, `NormalizeE164`, HTTP handlers, tests.
- `internal/emailverify/` — one-time email code generation/check, HTTP handlers.
- `internal/identity/identity.go` — Stripe Identity session creation.
- `internal/mail/mail.go` — `Send` (fixed claims inbox) + `SendTo` (per-call recipient).
- `internal/platform/ban.go` — `WithBanGuard` middleware.
- `internal/accountban/accountban.go` — shared `Ban` primitive for the two ban-evasion
  detectors (`ReasonBanEvasion`).
- `internal/chargeback/chargeback.go` — `banBuyer`, the original chargeback ban trigger
  (its own separate, unexported insert logic — not migrated to `accountban`).
- `internal/auction/checkout.go`, `buynow.go` — fingerprint blocking, fraud
  acknowledgment, KYC enforcement call sites.
- `internal/webhook/webhook.go` — `identity.verification_session.verified`
  (`recordIdentityVerified`, `identityFingerprint`), `setup_intent.succeeded` cases.
- `internal/phoneverify/http.go` — `checkPhoneReuse`.
- `migrations/0059_account_bans.*.sql`, `0060_email_verification.*.sql`,
  `0061_ban_evasion_detection.*.sql`.

**Frontend**
- `app/verify/layout.tsx`, `app/verify/{phone,email,identity,bank}/page.tsx`.
- `components/CodeInput.tsx`, `PhoneVerifyForm.tsx`, `EmailVerifyForm.tsx`,
  `IdentityVerifyButton.tsx`, `KycSummary.tsx`, `AccountBannedBanner.tsx`.
- `components/ShippingAddressGate.tsx` — the checkout-time fraud-policy checkbox.
- `components/Header.tsx` — `showCategoryNav` prop, ban banner.

---

## 14. Open questions (not yet decided)

Carried over from the original Plan B design, still unresolved:

1. Should Level 3 *also* gate a price threshold beyond unlocking ACH (the design doc's
   signature-confirmation-at-a-dollar-threshold pattern), or does Level 2 genuinely "let
   you buy anything" with no further gate, as originally decided?
2. Exact dollar caps — raised from $25 to $75 at Level 1 (the original figure was
   judged too restrictive for a card marketplace: plenty of legitimate singles and
   lower-end graded slabs land in the $30–80 range, and the other ban-evasion layers
   — payment-fingerprint blocking, phone/identity reuse detection (§4) — already
   bound fraud exposure independent of the dollar cap itself). Still worth revisiting
   again once there's real usage data.
3. No admin "unban" UI exists yet — reversing a mistaken ban is a direct database fix
   for now, not something built into the product.
4. Ban-evasion detection (§4) currently only bans the *new* account when it detects
   reuse — it doesn't do anything about legitimate-looking transactions that account
   may have already completed before detection ran (e.g. if identity verification
   happens after a purchase, not before). Worth revisiting whether detection should
   also trigger a review of that account's existing orders, not just future ones.
5. Device/browser fingerprinting (§4's "what this still doesn't catch") is real,
   separate future work if phone/identity reuse alone doesn't prove sufficient.
