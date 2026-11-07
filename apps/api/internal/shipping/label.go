package shipping

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"

	"github.com/jackc/pgx/v5/pgxpool"

	"auctionhous-tcg/api/internal/address"
	"auctionhous-tcg/api/internal/order"
	"auctionhous-tcg/api/internal/platform"
	"auctionhous-tcg/api/internal/user"
)

type buyLabelRequest struct {
	// FromAddressOverride lets the seller ship this one order from a
	// different return address than their saved Account Settings address,
	// without ever overwriting that saved default — the frontend always
	// prefills its edit form from GET /me/address first (CLAUDE.md's usual
	// "account settings is the starting point" pattern), then sends
	// whatever the seller actually edited here. Nil (the common case, and
	// always nil for the very first label bought on an order) means "use
	// the account address," same as before this field existed. Never
	// written to the addresses table — this is a one-time substitution for
	// a single label purchase, not a profile edit.
	FromAddressOverride *address.Address `json:"fromAddressOverride"`
}

type buyLabelResponse struct {
	TrackingNumber string `json:"trackingNumber"`
	Carrier        string `json:"carrier"`
	Service        string `json:"service"`
	LabelURL       string `json:"labelUrl"`
	CostCents      int64  `json:"costCents"`
	// LabelsRemaining is how many more times this order's label can be
	// changed (MaxLabelsPerOrder).
	LabelsRemaining int `json:"labelsRemaining"`
}

// HandleBuyLabel is the seller's "get a shipping label" action — rate-shop
// and buy a real label for this order, then record the result.
// Deliberately does NOT transition the order's state itself — MarkShipped
// (still gated on the design doc v2 §5.3 photo evidence) does that; the
// frontend is expected to call this first, then call MarkShipped with the
// carrier/tracking number this returns.
//
// Dispatches to Shippo or Pitney Bowes based on the order's own snapshotted
// shipping_preset — never re-derived from the listing's current preset
// here, since that's exactly the stale value order.CreateFromWin's
// UpgradePreset call already resolved. This is also the mechanism-locking
// the product explicitly requires: a tracked_envelope order can only ever
// reach the Pitney Bowes branch below, a shippo_ground_advantage order
// only the Shippo branch — there's no path for a seller to buy one label
// type and have it recorded as the other.
//
// Only callable while the order is still awaiting_ship — this is both the
// first-purchase path AND PrintLabelButton's "Change Shipping Label"
// re-purchase path, and a real bug once had the frontend offering "Change
// Shipping Label" after the item had already shipped, which would buy and
// record a second label (different tracking number, real vendor charge)
// for a package that had already gone out under the first one. Once
// MarkShipped has run there is nothing left to change, so this 409s.
func HandleBuyLabel(pool *pgxpool.Pool, shippoClient *Client, pbClient *PitneyBowesClient) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, order.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if callerID != o.SellerID {
			http.Error(w, "only the seller can buy a shipping label for this order", http.StatusForbidden)
			return
		}
		if o.State != order.StateAwaitingShip {
			http.Error(w, "a shipping label can only be bought or changed before the item ships", http.StatusConflict)
			return
		}

		var req buyLabelRequest
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil && !errors.Is(err, io.EOF) {
			http.Error(w, "invalid request body", http.StatusBadRequest)
			return
		}

		lockErr := withLabelLock(r.Context(), pool, o.ID, func() error {
			buyLabelLocked(w, r, pool, shippoClient, pbClient, o.ID, callerID, req)
			return nil
		})
		if errors.Is(lockErr, ErrLabelPurchaseInProgress) {
			http.Error(w, "A label is already being bought for this order. Please wait a moment and refresh.", http.StatusConflict)
			return
		}
		if lockErr != nil {
			http.Error(w, lockErr.Error(), http.StatusInternalServerError)
		}
	}
}

// buyLabelLocked does the purchase while HandleBuyLabel holds the order's
// label lock. It re-reads the order first, since another request may have
// changed it while this one waited.
//
// Replacing a label never leaves the order paying for two:
//   - Package (Shippo) labels: the new label is bought first, then the old
//     one is refunded. If Shippo won't refund the old one (usually because
//     the carrier already scanned it — it's been used), the new label is
//     refunded instead and the order keeps the old one. Either way the
//     order ends with exactly one paid-for label.
//   - Envelope (Pitney Bowes) labels can't be refunded at all, so each one's
//     cost is added to the order's label cost, which comes out of the
//     seller's proceeds.
//
// Both are capped at MaxLabelsPerOrder labels per order.
func buyLabelLocked(w http.ResponseWriter, r *http.Request, pool *pgxpool.Pool, shippoClient *Client, pbClient *PitneyBowesClient, orderID, callerID string, req buyLabelRequest) {
	ctx := r.Context()
	o, err := order.GetByID(ctx, pool, orderID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if o.State != order.StateAwaitingShip {
		http.Error(w, "a shipping label can only be bought or changed before the item ships", http.StatusConflict)
		return
	}

	labelCount, err := countLabels(ctx, pool, o.ID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	if labelCount >= MaxLabelsPerOrder {
		http.Error(w, fmt.Sprintf("This order has already had %d shipping labels, the most allowed. Contact support if you need another.", MaxLabelsPerOrder), http.StatusConflict)
		return
	}

	preset := PresetTrackedEnvelope
	if o.ShippingPreset != nil && Preset(*o.ShippingPreset).Valid() {
		preset = Preset(*o.ShippingPreset)
	}
	mechanism := preset.Mechanism()

	if mechanism == MechanismPackage && !shippoClient.IsConfigured() {
		http.Error(w, "shipping label purchase is not configured", http.StatusServiceUnavailable)
		return
	}
	if mechanism == MechanismLetter && !pbClient.IsConfigured() {
		http.Error(w, "tracked envelope label purchase is not configured", http.StatusServiceUnavailable)
		return
	}

	var fromAddr *address.Address
	if req.FromAddressOverride != nil {
		normalized := address.Normalize(*req.FromAddressOverride)
		if err := address.Validate(normalized); err != nil {
			http.Error(w, err.Error(), http.StatusBadRequest)
			return
		}
		fromAddr = &normalized
	} else {
		fromAddr, err = address.Get(ctx, pool, o.SellerID)
		if err != nil {
			if errors.Is(err, address.ErrNotFound) {
				http.Error(w, "add a return address in Account Settings before buying a label", http.StatusBadRequest)
				return
			}
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
	}
	toAddr, err := address.Get(ctx, pool, o.BuyerID)
	if err != nil {
		if errors.Is(err, address.ErrNotFound) {
			http.Error(w, "the buyer has no shipping address on file yet", http.StatusBadRequest)
			return
		}
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	// Both vendors require an email per address (discovered live with
	// Shippo) — the address book itself doesn't store one
	// (internal/address's own doc comment: that's shipping PII, not
	// identity), so pull each party's account email instead.
	fromUser, err := user.Get(ctx, pool, o.SellerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}
	toUser, err := user.Get(ctx, pool, o.BuyerID)
	if err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	var label *Label
	if mechanism == MechanismLetter {
		label, err = pbClient.BuyLabel(ctx, fromAddr, toAddr, fromUser.Email, toUser.Email)
	} else {
		label, err = shippoClient.BuyLabel(ctx, fromAddr, toAddr, fromUser.Email, toUser.Email, preset, o.SignatureRequired)
	}
	if err != nil {
		http.Error(w, err.Error(), http.StatusBadGateway)
		return
	}
	// Recorded before anything else, so even a label that ends up refunded
	// below counts toward the cap and leaves an audit trail.
	if err := recordLabel(ctx, pool, o.ID, mechanism, label); err != nil {
		log.Printf("shipping: order %s bought label %s but couldn't record it: %v", o.ID, label.ProviderShipmentID, err)
	}

	// Replacing a Shippo label: refund the old one now that the new one
	// exists. If that's refused, refund the new one instead and keep the old.
	if mechanism == MechanismPackage && o.ProviderShipmentID != nil && *o.ProviderShipmentID != "" {
		oldID := *o.ProviderShipmentID
		status, refundErr := shippoClient.RefundLabel(ctx, oldID)
		if refundErr != nil {
			_ = recordRefund(ctx, pool, o.ID, oldID, "rejected", refundErr.Error())
			newStatus, undoErr := shippoClient.RefundLabel(ctx, label.ProviderShipmentID)
			if undoErr != nil {
				_ = recordRefund(ctx, pool, o.ID, label.ProviderShipmentID, "rejected", undoErr.Error())
				log.Printf("shipping: order %s has two unrefundable labels (%s, %s) — needs manual review", o.ID, oldID, label.ProviderShipmentID)
			} else {
				_ = recordRefund(ctx, pool, o.ID, label.ProviderShipmentID, string(newStatus), "undone: old label couldn't be refunded")
			}
			http.Error(w, "Your current label can't be replaced because Shippo won't refund it — usually that means the carrier has already scanned it. Ship with your current label.", http.StatusConflict)
			return
		}
		_ = recordRefund(ctx, pool, o.ID, oldID, string(status), "")
	}

	// What the order records as its label cost (deducted from the seller's
	// proceeds). A replaced Shippo label was refunded above, so only the new
	// one counts. Envelope labels can't be refunded, so every one bought on
	// this order adds up — mechanism never changes during an order, so any
	// existing cost on a letter order is earlier envelope labels.
	recordedCostCents := label.CostCents
	if mechanism == MechanismLetter && o.LabelCostCents != nil && *o.LabelCostCents > 0 {
		recordedCostCents += *o.LabelCostCents
	}

	if err := order.SetLabel(ctx, pool, o.ID, callerID, label.Carrier, label.TrackingNumber, label.ProviderShipmentID, label.LabelURL, recordedCostCents); err != nil {
		http.Error(w, err.Error(), http.StatusInternalServerError)
		return
	}

	w.Header().Set("Content-Type", "application/json")
	json.NewEncoder(w).Encode(buyLabelResponse{
		TrackingNumber:  label.TrackingNumber,
		Carrier:         label.Carrier,
		Service:         label.Service,
		LabelURL:        label.LabelURL,
		CostCents:       recordedCostCents,
		LabelsRemaining: MaxLabelsPerOrder - (labelCount + 1),
	})
}

// HandleDownloadLabel proxies the order's already-purchased label PDF
// through our own backend rather than letting the frontend link straight
// to Shippo's signed URL — a plain cross-origin link there gets its
// `download` attribute silently ignored by the browser, so it opens the
// PDF viewer instead of downloading (the actual bug this fixes). Fetching
// server-side and replying with Content-Disposition: attachment forces a
// real download regardless of origin, and sidesteps needing Shippo's CDN to
// support CORS for a client-side fetch in the first place.
func HandleDownloadLabel(pool *pgxpool.Pool) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		callerID, ok := platform.UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}

		o, err := order.GetForListing(r.Context(), pool, r.PathValue("id"))
		if err != nil {
			status := http.StatusInternalServerError
			if errors.Is(err, order.ErrNotFound) {
				status = http.StatusNotFound
			}
			http.Error(w, err.Error(), status)
			return
		}
		if callerID != o.SellerID {
			http.Error(w, "only the seller can download this order's shipping label", http.StatusForbidden)
			return
		}
		if o.LabelURL == nil || *o.LabelURL == "" {
			http.Error(w, "no shipping label has been purchased for this order yet", http.StatusNotFound)
			return
		}

		req, err := http.NewRequestWithContext(r.Context(), http.MethodGet, *o.LabelURL, nil)
		if err != nil {
			http.Error(w, err.Error(), http.StatusInternalServerError)
			return
		}
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			http.Error(w, "failed to fetch label: "+err.Error(), http.StatusBadGateway)
			return
		}
		defer resp.Body.Close()
		if resp.StatusCode != http.StatusOK {
			http.Error(w, fmt.Sprintf("label host returned %d", resp.StatusCode), http.StatusBadGateway)
			return
		}

		filename := "shipping-label.pdf"
		if o.TrackingNumber != nil && *o.TrackingNumber != "" {
			filename = fmt.Sprintf("shipping-label-%s.pdf", *o.TrackingNumber)
		}
		w.Header().Set("Content-Type", "application/pdf")
		w.Header().Set("Content-Disposition", fmt.Sprintf(`attachment; filename="%s"`, filename))
		io.Copy(w, resp.Body)
	}
}
