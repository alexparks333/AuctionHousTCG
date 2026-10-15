package auction

import (
	"context"
	"encoding/json"
	"errors"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/address"
	"auctionhous-tcg/api/internal/kyc"
	"auctionhous-tcg/api/internal/listing"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/payment"
	"auctionhous-tcg/api/internal/paymentmethod"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/seller"
	"auctionhous-tcg/api/internal/shipping"
	"auctionhous-tcg/api/internal/user"
)

// ErrSellerNotOnboarded blocks checkout when the seller hasn't finished
// Stripe Connect onboarding — a direct charge (design doc v2 §5.3) can only
// be created on a connected account that Stripe has actually enabled for
// charges, never a bare stripe_account_id that exists but never finished
// verification.
var ErrSellerNotOnboarded = errors.New("this seller hasn't finished setting up payouts yet")

// errBannedFingerprint blocks a checkout intent before any money moves —
// the pre-charge half of the ban-evasion check, for a saved card/bank
// whose fingerprint is already knowable (unlike a brand-new card, which
// can only be checked post-capture — see buynow.go's
// checkFraudAndStampOrder). A banned account's own saved methods are
// already unusable (WithBanGuard 403s the whole request), so what this
// actually catches is a *different, non-banned* account reusing the same
// physical card/bank a banned account used before — the actual evasion
// path this exists to close.
var errBannedFingerprint = errors.New("this payment method is associated with a banned account")

// blockedByBannedFingerprint reports whether paymentMethodID's underlying
// card/bank-account fingerprint has ever been used on an order whose buyer
// is currently banned for chargeback fraud. paymentMethodID empty (no
// saved method resolved) is never blocked — CreateIntent/CreateAchIntent
// fall through to a fresh, not-yet-known card entered directly in the
// Payment Element in that case, which the post-capture check covers
// instead.
func blockedByBannedFingerprint(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, paymentMethodID string) (bool, error) {
	if paymentMethodID == "" {
		return false, nil
	}
	pm, err := paymentClient.RetrievePaymentMethod(ctx, paymentMethodID)
	if err != nil {
		return false, err
	}
	fingerprint := payment.FingerprintOfMethod(pm)
	if fingerprint == "" {
		return false, nil
	}
	var banned bool
	if err := pool.QueryRow(ctx, `
		select exists(
			select 1 from orders o
			join account_suspensions s on s.user_id = o.buyer_id
			where o.buyer_payment_fingerprint = $1 and s.reason = 'chargeback_fraud' and now() < s.ends_at
		)
	`, fingerprint).Scan(&banned); err != nil {
		return false, err
	}
	return banned, nil
}

type checkoutIntentResponse struct {
	ClientSecret    string `json:"clientSecret"`
	PaymentIntentID string `json:"paymentIntentId"`
	Rail            string `json:"rail"`
	// AmountCents is what this specific intent actually charges — matches
	// CardAmountCents or BankAmountCents below depending on Rail.
	AmountCents int64 `json:"amountCents"`
	// CardAmountCents/BankAmountCents/RealizedSavingCents let the checkout
	// page show both prices side by side (design doc v2 §2.7: card is
	// always the default/listed price, bank framed as a savings offer)
	// without a second round trip — the buyer sees the choice before
	// picking a rail, this response just reflects whichever they already
	// picked (or "card", the default, on first load).
	CardAmountCents     int64 `json:"cardAmountCents"`
	BankAmountCents     int64 `json:"bankAmountCents"`
	RealizedSavingCents int64 `json:"realizedSavingCents"`
	// SellerFeeCents/SellerNetCents are identical regardless of rail
	// (design doc v2 §2.3's invariant) — informational, exposed for the
	// same "transparency by default" reason as docs/PercentageModel.md §3.
	SellerFeeCents int64 `json:"sellerFeeCents"`
	SellerNetCents int64 `json:"sellerNetCents"`
	TaxCents       int64 `json:"taxCents"`
	// SubtotalCents/ShippingCents were already computed below (subtotalCents,
	// shippingCents) but never actually put on the response — MockCheckout.tsx
	// showed only the raw item price as "Total" with no breakdown, so a buyer
	// saw e.g. "Total $66.66" up top and "Pay $68.22" at the bottom with no
	// visible reconciliation between the two (the $1.56 gap was shipping, not
	// missing tax, but from a buyer's seat it read as an unexplained charge
	// either way). Identical regardless of rail, same as SellerFeeCents above
	// — only TaxCents/the final total actually vary between card and bank.
	SubtotalCents int64 `json:"subtotalCents"`
	ShippingCents int64 `json:"shippingCents"`
	// ItemCents/AddonsCents split SubtotalCents into the primary listing's
	// own price and the checkout add-ons on top of it ("Add Singles To Your
	// Order") — AddonsCents is 0 for a plain single-card checkout.
	// CardCount is every card in the shipment (primary + add-ons), and
	// ShippingPreset is what it resolved to after the price and bundle-size
	// upgrades (shipping.UpgradePreset/UpgradeForItemCount), so the
	// checkout page can say "upgraded to a tracked package" when it is.
	ItemCents      int64  `json:"itemCents"`
	AddonsCents    int64  `json:"addonsCents"`
	CardCount      int    `json:"cardCount"`
	ShippingPreset string `json:"shippingPreset"`
	// SavedCard/SavedBank reflect whichever saved payment method actually
	// ended up attached to this intent — either paymentMethodId (below)
	// if the buyer explicitly picked one in MockCheckout.tsx's picker, or
	// their default, if they haven't chosen yet. Never both set at once
	// (Rail decides which one is even possible). A connected-account
	// direct charge can't show Stripe's own "browse every saved method"
	// Payment Element carousel (design doc v2 §5.4 — see
	// payment.ClonePaymentMethodToConnectedAccount's doc comment for why),
	// so this app's own frontend UI is the picker instead.
	SavedCard *paymentmethod.SavedCard `json:"savedCard,omitempty"`
	SavedBank *paymentmethod.SavedBank `json:"savedBank,omitempty"`
}

// HandleCreateCheckoutIntent authorizes a payment for listingID's Buy It
// Now price on the rail the buyer picked (?rail=card, the default, or
// ?rail=ach) — the first step of the real Stripe checkout flow. Lazy per-
// rail creation, not both up front, so switching rails on the checkout page
// doesn't leave an unused intent behind (design doc v2 §6's recommendation).
// This never touches the listing itself: two buyers can both call this for
// the same listing and both get a valid authorization, exactly like both
// being able to sit on the checkout page at once. The price/eligibility
// checks here are a courtesy (so the UI doesn't authorize a payment for a
// listing that's obviously already gone) — the real, race-safe guard is
// still the atomic compare-and-swap in HandleBuyNow, re-checked from
// scratch (including the fee quote, quoteForListing) when the payment is
// actually resolved.
func HandleCreateCheckoutIntent(pool *pgxpool.Pool, paymentClient *payment.Client, shippoClient *shipping.Client) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		buyerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		rail := order.RailCard
		if r.URL.Query().Get("rail") == "ach" {
			rail = order.RailAch
		}
		// Set only when the buyer explicitly picked a specific saved
		// card/bank in MockCheckout.tsx's picker (as opposed to just
		// letting their default auto-attach, the fallback below).
		chosenPaymentMethodID := r.URL.Query().Get("paymentMethodId")

		// Optional JSON body: the add-ons the buyer picked on the checkout
		// page. No body (or an empty list) is a plain single-card checkout,
		// exactly as before add-ons existed.
		var body struct {
			Addons []AddonRequest `json:"addons"`
		}
		if r.Body != nil && r.ContentLength != 0 {
			if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
				http.Error(w, "invalid request body", http.StatusBadRequest)
				return
			}
		}

		listingID := r.PathValue("id")
		lst, err := listing.Get(r.Context(), pool, listingID)
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, listing.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}

		if buyerID == lst.SellerID {
			http.Error(w, listing.ErrSelfPurchase.Error(), http.StatusForbidden)
			return
		}

		var subtotalCents int64
		switch {
		// A fixed listing already reserved for THIS buyer and not yet
		// paid — only reachable via an accepted offer (internal/offer.
		// Accept), which sets buyer_id/sold_price_cents immediately but
		// leaves payment as a separate step, same "won, pay later" shape
		// as the auction case below. Checked before the generic
		// FormatFixed case so this buyer's own pending win resolves to
		// "pay what was agreed," not "already sold."
		case lst.Format == listing.FormatFixed && lst.BuyerID != nil && *lst.BuyerID == buyerID:
			if lst.PaidAt != nil {
				http.Error(w, ErrAlreadyPaid.Error(), http.StatusConflict)
				return
			}
			if lst.SoldPriceCents != nil {
				subtotalCents = *lst.SoldPriceCents
			} else if lst.PriceCents != nil {
				subtotalCents = *lst.PriceCents
			}

		case lst.Format == listing.FormatFixed:
			if lst.BuyerID != nil {
				http.Error(w, listing.ErrAlreadySold.Error(), http.StatusConflict)
				return
			}
			if lst.PriceCents != nil {
				subtotalCents = *lst.PriceCents
			}

		// Won via regular bidding (not Buy It Now) and not yet paid —
		// ownership already resolved when the auction closed, so this is
		// purely a payment step (PayForWonAuction in buynow.go), at the
		// final winning bid amount. Checked before the BuyItNowPriceCents
		// case below so an auction that also happened to have a BIN price
		// still resolves to "pay what I won it for," not "buy it now."
		case lst.Outcome != nil && *lst.Outcome == "sold" &&
			lst.HighBidderID != nil && *lst.HighBidderID == buyerID:
			if lst.PaidAt != nil {
				http.Error(w, ErrAlreadyPaid.Error(), http.StatusConflict)
				return
			}
			if lst.CurrentPriceCents != nil {
				subtotalCents = *lst.CurrentPriceCents
			}

		case lst.BuyItNowPriceCents != nil:
			if lst.Outcome != nil {
				http.Error(w, ErrAuctionEnded.Error(), http.StatusConflict)
				return
			}
			subtotalCents = *lst.BuyItNowPriceCents

		default:
			http.Error(w, ErrNoBuyItNowPrice.Error(), http.StatusConflict)
			return
		}
		if subtotalCents <= 0 {
			http.Error(w, "listing has no purchasable price", http.StatusConflict)
			return
		}

		// Priced from the database, never from the request — the request
		// only names ids and quantities.
		addons, err := resolveAddons(r.Context(), pool, lst.SellerID, buyerID, listingID, body.Addons)
		if err != nil {
			var unavailable *AddonUnavailableError
			switch {
			case errors.As(err, &unavailable):
				// 422, not 409: 409 means "the card you're checking out
				// is already sold" to MockCheckout, a different message.
				http.Error(w, err.Error(), http.StatusUnprocessableEntity)
			case errors.Is(err, errTooManyAddons):
				http.Error(w, err.Error(), http.StatusBadRequest)
			default:
				http.Error(w, err.Error(), http.StatusInternalServerError)
			}
			return
		}
		itemCents := subtotalCents
		subtotalCents += addonsSubtotal(addons)
		cardCount := 1 + addonsCardCount(addons)

		level, err := kyc.LevelForUser(r.Context(), pool, buyerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := kyc.CheckPurchase(level, subtotalCents); err != nil {
			// subtotalCents already includes add-ons here, so the KYC
			// purchase cap applies to the whole bundle, not just the card.
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}

		stripeAccountID, err := seller.RequirePayoutsEnabled(r.Context(), pool, lst.SellerID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if stripeAccountID == "" {
			// Deliberately NOT StatusConflict (409) — that's what "this
			// listing is already sold/ended" maps to on the frontend
			// (MockCheckout's AlreadyPurchasedNotice), and this is a
			// completely different condition (the seller hasn't finished
			// Connect onboarding) that needs its own distinct message.
			http.Error(w, ErrSellerNotOnboarded.Error(), http.StatusPreconditionFailed)
			return
		}

		// The listing's own preset is only the seller's listing-time floor —
		// resolve it against this specific sale's subtotal the same way
		// createOrderRecord does at capture time (shipping.UpgradePreset),
		// so the authorized amount and the eventually-recorded order amount
		// can never drift apart.
		resolvedPreset, signatureRequired := shipping.UpgradePreset(shipping.Preset(lst.ShippingPreset), subtotalCents, lst.RequestSignature)
		// A bundle too big for an envelope ships as a package — computed
		// identically in createOrderRecord from the same add-on rows.
		resolvedPreset = shipping.UpgradeForItemCount(resolvedPreset, cardCount)

		// Real, live-quoted shipping cost — not the listing's frozen
		// estimate — whenever a real quote is actually possible: this is
		// the checkout-time recalculation against the real buyer address
		// that shipping.ChargedCentsLive's own doc comment describes,
		// same "quote the actual buyer, not a placeholder" rule eBay's
		// calculated shipping follows. Both addresses are only fetched for
		// the one preset that can ever need Shippo (free/tracked_envelope
		// presets are flat/free regardless, per ChargedCentsLive's own
		// early return) — no point in two DB round trips otherwise.
		var sellerAddr, buyerAddr *address.Address
		var sellerEmail, buyerEmail string
		if resolvedPreset == shipping.PresetShippoGroundAdvantage {
			if a, err := address.Get(r.Context(), pool, lst.SellerID); err == nil {
				sellerAddr = a
			}
			if a, err := address.Get(r.Context(), pool, buyerID); err == nil {
				buyerAddr = a
			}
			if sellerAddr != nil && buyerAddr != nil {
				if u, err := user.Get(r.Context(), pool, lst.SellerID); err == nil {
					sellerEmail = u.Email
				}
				if u, err := user.Get(r.Context(), pool, buyerID); err == nil {
					buyerEmail = u.Email
				}
			}
		}
		shippingCents := shipping.ChargedCentsLive(
			r.Context(), shippoClient, resolvedPreset, sellerAddr, buyerAddr, sellerEmail, buyerEmail,
			signatureRequired, lst.EstimatedShippingCents,
		)

		quote, _, _, err := quoteForListing(r.Context(), pool, lst.SellerID, subtotalCents, shippingCents)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp := checkoutIntentResponse{
			Rail:                string(rail),
			CardAmountCents:     int64(quote.CardTotal),
			BankAmountCents:     int64(quote.BankTotal),
			RealizedSavingCents: int64(quote.RealizedSaving),
			SellerFeeCents:      int64(quote.SellerFee),
			SellerNetCents:      int64(quote.SellerNet),
			SubtotalCents:       subtotalCents,
			ShippingCents:       shippingCents,
			ItemCents:           itemCents,
			AddonsCents:         subtotalCents - itemCents,
			CardCount:           cardCount,
			ShippingPreset:      string(resolvedPreset),
		}

		if rail == order.RailAch {
			// Auto-attach a saved bank account if there is one — either
			// whichever one the buyer explicitly picked in MockCheckout.tsx's
			// picker (chosenPaymentMethodID), or their default. Charged
			// directly on the platform account (this package's own doc
			// comment) — no cloning onto a connected account needed, the
			// buyer's platform-level Customer/PaymentMethod is exactly what
			// this PaymentIntent is created against.
			var paymentMethodID string
			var savedBank *paymentmethod.SavedBank
			platformCustomerID, bank, hasSaved, err := resolveBank(r.Context(), pool, paymentClient, buyerID, chosenPaymentMethodID)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if hasSaved {
				paymentMethodID = bank.ID
				savedBank = bank
			}
			if blocked, err := blockedByBannedFingerprint(r.Context(), pool, paymentClient, paymentMethodID); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			} else if blocked {
				http.Error(w, errBannedFingerprint.Error(), http.StatusForbidden)
				return
			}

			pi, err := paymentClient.CreateAchIntent(r.Context(), listingID, buyerID, int64(quote.BankTotal), paymentMethodID, platformCustomerID, shippingCents, signatureRequired)
			if err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			if err := saveCheckoutAddons(r.Context(), pool, pi.ID, addons); err != nil {
				http.Error(w, err.Error(), http.StatusInternalServerError)
				return
			}
			resp.ClientSecret = pi.ClientSecret
			resp.PaymentIntentID = pi.ID
			resp.AmountCents = int64(quote.BankTotal)
			resp.TaxCents = int64(quote.BankTax)
			resp.SavedBank = savedBank
			w.Header().Set("Content-Type", "application/json")
			json.NewEncoder(w).Encode(resp)
			return
		}

		// Auto-attach a saved card if there is one — either whichever one
		// the buyer explicitly picked in MockCheckout.tsx's picker
		// (chosenPaymentMethodID), or their default. Charged directly on
		// the platform account (this package's own doc comment) — the
		// buyer's platform-level Customer/PaymentMethod is exactly what
		// this PaymentIntent is created against, no cloning required.
		var paymentMethodID string
		var savedCard *paymentmethod.SavedCard
		platformCustomerID, card, hasSaved, err := resolveCard(r.Context(), pool, paymentClient, buyerID, chosenPaymentMethodID)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if hasSaved {
			paymentMethodID = card.ID
			savedCard = card
		}
		if blocked, err := blockedByBannedFingerprint(r.Context(), pool, paymentClient, paymentMethodID); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		} else if blocked {
			http.Error(w, errBannedFingerprint.Error(), http.StatusForbidden)
			return
		}

		pi, err := paymentClient.CreateIntent(r.Context(), listingID, buyerID, int64(quote.CardTotal), paymentMethodID, platformCustomerID, shippingCents, signatureRequired)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		if err := saveCheckoutAddons(r.Context(), pool, pi.ID, addons); err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}

		resp.ClientSecret = pi.ClientSecret
		resp.PaymentIntentID = pi.ID
		resp.AmountCents = int64(quote.CardTotal)
		resp.TaxCents = int64(quote.CardTax)
		resp.SavedCard = savedCard

		w.Header().Set("Content-Type", "application/json")
		json.NewEncoder(w).Encode(resp)
	}
}

// resolveCard decides which of buyerID's platform-level saved cards (if
// any) this checkout should pre-attach: chosenID, if the buyer explicitly
// picked one in MockCheckout.tsx's picker (verified as actually theirs),
// otherwise their default. ok is false — never an error on its own — when
// there's simply nothing to pre-fill, either because chosenID belongs to
// someone else/doesn't exist (silently falls through rather than 500ing
// over a stale client-side id) or because the buyer has no saved cards at
// all.
func resolveCard(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, buyerID, chosenID string) (platformCustomerID string, card *paymentmethod.SavedCard, ok bool, err error) {
	if chosenID != "" {
		platformCustomerID, card, err = paymentmethod.Get(ctx, pool, paymentClient, buyerID, chosenID)
		if err != nil {
			if errors.Is(err, paymentmethod.ErrNotFound) {
				return "", nil, false, nil
			}
			return "", nil, false, err
		}
		return platformCustomerID, card, true, nil
	}
	return paymentmethod.DefaultCard(ctx, pool, paymentClient, buyerID)
}

// resolveBank is resolveCard's bank-account counterpart.
func resolveBank(ctx context.Context, pool *pgxpool.Pool, paymentClient *payment.Client, buyerID, chosenID string) (platformCustomerID string, bank *paymentmethod.SavedBank, ok bool, err error) {
	if chosenID != "" {
		platformCustomerID, bank, err = paymentmethod.GetBank(ctx, pool, paymentClient, buyerID, chosenID)
		if err != nil {
			if errors.Is(err, paymentmethod.ErrNotFound) {
				return "", nil, false, nil
			}
			return "", nil, false, err
		}
		return platformCustomerID, bank, true, nil
	}
	return paymentmethod.DefaultBank(ctx, pool, paymentClient, buyerID)
}
