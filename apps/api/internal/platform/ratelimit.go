package platform

import (
	"fmt"
	"log"
	"math"
	"net/http"
	"sync"
	"time"
)

// Rate limiting for the endpoints that cost real money per call (Twilio SMS,
// Stripe Identity, Google Places, Pitney Bowes/Shippo) or guard a short code
// that could otherwise be brute-forced (email/phone verification).
//
// In-memory and per-process: enough for a single API instance, which is what
// runs today. If the API is ever scaled to several instances, each keeps its
// own counts (so the effective limit multiplies by the instance count) —
// move the counters to Redis/Postgres at that point.

// RateRule allows at most Max calls per Window. A limiter can enforce
// several rules at once, e.g. 5 per hour and 10 per day.
type RateRule struct {
	Max    int
	Window time.Duration
}

// RateLimiter counts calls per key (a user ID) in sliding windows.
type RateLimiter struct {
	name string
	// perUser applies to each user separately; global applies to every
	// user combined — a ceiling against abuse spread across many accounts.
	perUser []RateRule
	global  []RateRule
	now     func() time.Time

	mu     sync.Mutex
	hits   map[string][]time.Time
	lastGC time.Time
}

const globalRateKey = "\x00global"

func NewRateLimiter(name string, perUser []RateRule, global ...RateRule) *RateLimiter {
	return &RateLimiter{name: name, perUser: perUser, global: global, now: time.Now, hits: map[string][]time.Time{}}
}

// Allow records a call for key if it's within every rule, and otherwise
// reports how long until the next call would be allowed. A refused call
// isn't recorded, so hammering a limit doesn't extend it.
func (l *RateLimiter) Allow(key string) (bool, time.Duration) {
	l.mu.Lock()
	defer l.mu.Unlock()
	now := l.now()
	l.gc(now)

	wait := retryAfter(l.hits[key], l.perUser, now)
	if w := retryAfter(l.hits[globalRateKey], l.global, now); w > wait {
		wait = w
	}
	if wait > 0 {
		return false, wait
	}
	l.hits[key] = append(prune(l.hits[key], longest(l.perUser), now), now)
	if len(l.global) > 0 {
		l.hits[globalRateKey] = append(prune(l.hits[globalRateKey], longest(l.global), now), now)
	}
	return true, 0
}

// retryAfter is how long until hits satisfies every rule again (0 if it
// already does).
func retryAfter(hits []time.Time, rules []RateRule, now time.Time) time.Duration {
	var wait time.Duration
	for _, r := range rules {
		start := now.Add(-r.Window)
		var inWindow []time.Time
		for _, t := range hits {
			if t.After(start) {
				inWindow = append(inWindow, t)
			}
		}
		if len(inWindow) >= r.Max {
			// The oldest call that has to age out before one more fits.
			w := inWindow[len(inWindow)-r.Max].Add(r.Window).Sub(now)
			if w > wait {
				wait = w
			}
		}
	}
	return wait
}

func longest(rules []RateRule) time.Duration {
	var d time.Duration
	for _, r := range rules {
		if r.Window > d {
			d = r.Window
		}
	}
	return d
}

func prune(hits []time.Time, keep time.Duration, now time.Time) []time.Time {
	start := now.Add(-keep)
	i := 0
	for i < len(hits) && !hits[i].After(start) {
		i++
	}
	return hits[i:]
}

// gc drops keys with no recent calls, at most once a minute.
func (l *RateLimiter) gc(now time.Time) {
	if now.Sub(l.lastGC) < time.Minute {
		return
	}
	l.lastGC = now
	keepUser, keepGlobal := longest(l.perUser), longest(l.global)
	for k, hits := range l.hits {
		keep := keepUser
		if k == globalRateKey {
			keep = keepGlobal
		}
		if hits = prune(hits, keep, now); len(hits) == 0 {
			delete(l.hits, k)
		} else {
			l.hits[k] = hits
		}
	}
}

// Wrap rate-limits an authenticated handler by the caller's user ID. Goes
// inside RequireAuth. Over the limit it answers 429 with a Retry-After
// header and a message the frontend can show as-is.
func (l *RateLimiter) Wrap(next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		userID, ok := UserIDFromContext(r.Context())
		if !ok {
			http.Error(w, "unauthorized", http.StatusUnauthorized)
			return
		}
		if allowed, wait := l.Allow(userID); !allowed {
			log.Printf("rate limit: %s refused for user %s (retry in %s)", l.name, userID, wait.Round(time.Second))
			secs := int(math.Ceil(wait.Seconds()))
			w.Header().Set("Retry-After", fmt.Sprint(secs))
			http.Error(w, "Too many attempts. Please try again "+humanWait(wait)+".", http.StatusTooManyRequests)
			return
		}
		next.ServeHTTP(w, r)
	})
}

func humanWait(d time.Duration) string {
	switch {
	case d <= time.Minute:
		return "in a minute"
	case d <= 55*time.Minute:
		return fmt.Sprintf("in %d minutes", int(math.Ceil(d.Minutes())))
	case d < 2*time.Hour:
		return "in about an hour"
	default:
		return fmt.Sprintf("in about %d hours", int(math.Ceil(d.Hours())))
	}
}
