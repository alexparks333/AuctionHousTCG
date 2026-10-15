// Package mail sends real transactional email via Resend — originally for
// exactly one thing: internal/dispute alerting support@auctionhous.net when
// a claim lands in human_review (the cases that actually need a person,
// deliberately not every claim opened — see claim.go's Escalate). Now also
// backs internal/emailverify's one-time codes (KYC level 1, Plan B /
// CLAUDE.md §7) via SendTo, which sends to a per-call recipient rather
// than this Client's own fixed `to` — cmd/api/main.go constructs a second
// Client (same Resend API key, a different `from` display name suited for
// account email rather than internal ops alerts) for that purpose.
package mail

import (
	"context"
	"fmt"

	"github.com/resend/resend-go/v2"
)

// Client is nil when RESEND_API_KEY isn't set — same graceful-degradation
// pattern as payment.Client/shipping.Client: callers check IsConfigured()
// and skip sending rather than failing to boot.
type Client struct {
	rs   *resend.Client
	from string
	to   string
}

// NewClient builds a mail client, or returns nil if apiKey is empty. from
// and to are the fixed sender/recipient for the one notification this
// package sends — not a general-purpose "send to anyone" API, so there's no
// per-call from/to to get wrong.
func NewClient(apiKey, from, to string) *Client {
	if apiKey == "" {
		return nil
	}
	return &Client{rs: resend.NewClient(apiKey), from: from, to: to}
}

func (c *Client) IsConfigured() bool {
	return c != nil
}

// Send fires one email from/to the fixed addresses this client was built
// with. Callers treat a failure as logged-not-fatal (see claim.go's
// Escalate) — a missed notification email is a recoverable, visible
// problem, not a reason to leave a claim stuck mid-transition.
func (c *Client) Send(ctx context.Context, subject, html string) error {
	_, err := c.rs.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    c.from,
		To:      []string{c.to},
		Subject: subject,
		Html:    html,
	})
	if err != nil {
		return fmt.Errorf("send mail: %w", err)
	}
	return nil
}

// SendTo fires one email from this Client's fixed `from` address to an
// explicit, per-call recipient — unlike Send above, which only ever mails
// this Client's own fixed `to` (the claims-notification inbox). Used by
// internal/emailverify to mail a one-time code to whichever user is
// verifying their own account email, which is a different recipient every
// call and can't be a Client-level fixed field the way the claims inbox is.
func (c *Client) SendTo(ctx context.Context, to, subject, html string) error {
	_, err := c.rs.Emails.SendWithContext(ctx, &resend.SendEmailRequest{
		From:    c.from,
		To:      []string{to},
		Subject: subject,
		Html:    html,
	})
	if err != nil {
		return fmt.Errorf("send mail: %w", err)
	}
	return nil
}
