// Package phoneverify wraps Twilio's Verify V2 API (SMS one-time codes) —
// KYC level 1 (internal/kyc, Plan B / CLAUDE.md §7's chargeback-fraud ban
// system). A thin, direct net/http client, not the official Twilio Go SDK
// — same "raw HTTP client over a vendor SDK for two endpoints" choice this
// codebase already made for Pitney Bowes (internal/shipping), confirmed
// against Twilio's own current API reference rather than assumed:
// POST /v2/Services/{ServiceSid}/Verifications (start) and
// POST /v2/Services/{ServiceSid}/VerificationCheck (check), both HTTP
// Basic Auth on the account SID/auth token, form-encoded body.
package phoneverify

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"regexp"
	"strings"
	"time"
)

const baseURL = "https://verify.twilio.com/v2"

// ErrCodeNotApproved is returned by CheckVerification when Twilio's own
// response status isn't "approved" — covers a wrong code, an expired one,
// too many attempts, and everything else Twilio itself distinguishes, none
// of which this package's caller needs to tell apart: either the code was
// right or it wasn't.
var ErrCodeNotApproved = errors.New("verification code is incorrect or expired")

// Client is nil-safe — every method on a nil/unconfigured Client returns
// an error rather than panicking, same graceful-degradation shape as
// internal/shipping.Client when Shippo isn't configured, so callers can
// construct one unconditionally at startup and only check IsConfigured
// where it actually matters (route registration).
type Client struct {
	accountSID string
	authToken  string
	serviceSID string
	hc         *http.Client
}

func NewClient(accountSID, authToken, serviceSID string) *Client {
	return &Client{
		accountSID: accountSID,
		authToken:  authToken,
		serviceSID: serviceSID,
		hc:         &http.Client{Timeout: 15 * time.Second},
	}
}

func (c *Client) IsConfigured() bool {
	return c != nil && c.accountSID != "" && c.authToken != "" && c.serviceSID != ""
}

// StartVerification sends a one-time SMS code to phone, normalizing it to
// E.164 first (NormalizeE164) — real, live-found gap: a plain 10-digit US
// number typed with no country code (e.g. "8188078706", no "+1") is
// exactly what a user types into a bare "Phone number" field with no
// formatting hint enforced, and Twilio's own API rejects it outright
// ("Invalid parameter `To`") rather than assuming a country code the way
// this app's own domestic-only scope (CLAUDE.md §6.11) would justify.
func (c *Client) StartVerification(ctx context.Context, phone string) error {
	if !c.IsConfigured() {
		return fmt.Errorf("phone verification is not configured")
	}
	form := url.Values{"To": {NormalizeE164(phone)}, "Channel": {"sms"}}
	return c.post(ctx, fmt.Sprintf("/Services/%s/Verifications", c.serviceSID), form, nil)
}

// verificationCheckResponse is Twilio's Verification Check resource — only
// the field this package actually branches on.
type verificationCheckResponse struct {
	Status string `json:"status"`
}

// CheckVerification validates the code the user typed against the
// verification StartVerification started for phoneE164. Returns nil only
// when Twilio's own status is "approved" — ErrCodeNotApproved for every
// other status (pending/canceled/max_attempts_reached/expired/etc, none
// of which this app's UI needs to distinguish).
func (c *Client) CheckVerification(ctx context.Context, phone, code string) error {
	if !c.IsConfigured() {
		return fmt.Errorf("phone verification is not configured")
	}
	form := url.Values{"To": {NormalizeE164(phone)}, "Code": {code}}
	var resp verificationCheckResponse
	if err := c.post(ctx, fmt.Sprintf("/Services/%s/VerificationCheck", c.serviceSID), form, &resp); err != nil {
		return err
	}
	if resp.Status != "approved" {
		return ErrCodeNotApproved
	}
	return nil
}

var nonDigit = regexp.MustCompile(`[^\d]`)

// NormalizeE164 turns a plain, human-typed phone number into E.164 —
// domestic-only (CLAUDE.md §6.11: this app is US-only in v1), so the only
// cases handled are the ones a real US user's input actually produces:
// already-E.164 ("+18188078706", left alone), a bare 10-digit number
// ("8188078706" -> "+18188078706"), and an 11-digit number already
// carrying the leading "1" ("18188078706" -> "+18188078706"). Anything
// else is passed through with a leading "+" added if missing, and left to
// Twilio's own validation to reject with a clear error — this is
// normalization for the common case, not a general phone-number parser.
func NormalizeE164(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if strings.HasPrefix(trimmed, "+") {
		return "+" + nonDigit.ReplaceAllString(trimmed, "")
	}
	digits := nonDigit.ReplaceAllString(trimmed, "")
	switch len(digits) {
	case 10:
		return "+1" + digits
	case 11:
		if strings.HasPrefix(digits, "1") {
			return "+" + digits
		}
	}
	return "+" + digits
}

func (c *Client) post(ctx context.Context, path string, form url.Values, out any) error {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, baseURL+path, strings.NewReader(form.Encode()))
	if err != nil {
		return fmt.Errorf("build twilio request: %w", err)
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	req.SetBasicAuth(c.accountSID, c.authToken)

	res, err := c.hc.Do(req)
	if err != nil {
		return fmt.Errorf("twilio request: %w", err)
	}
	defer res.Body.Close()

	if res.StatusCode < 200 || res.StatusCode >= 300 {
		var apiErr struct {
			Message string `json:"message"`
		}
		_ = json.NewDecoder(res.Body).Decode(&apiErr)
		if apiErr.Message != "" {
			return fmt.Errorf("twilio: %s", apiErr.Message)
		}
		return fmt.Errorf("twilio: unexpected status %d", res.StatusCode)
	}
	if out == nil {
		return nil
	}
	return json.NewDecoder(res.Body).Decode(out)
}
