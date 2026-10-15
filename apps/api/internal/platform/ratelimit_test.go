package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"
)

type fakeClock struct{ t time.Time }

func (c *fakeClock) now() time.Time          { return c.t }
func (c *fakeClock) advance(d time.Duration) { c.t = c.t.Add(d) }

func newTestLimiter(perUser []RateRule, global ...RateRule) (*RateLimiter, *fakeClock) {
	clock := &fakeClock{t: time.Date(2026, 10, 15, 12, 0, 0, 0, time.UTC)}
	l := NewRateLimiter("test", perUser, global...)
	l.now = clock.now
	return l, clock
}

func TestRateLimiterAllowsUpToMaxThenRefuses(t *testing.T) {
	l, _ := newTestLimiter([]RateRule{{Max: 3, Window: time.Hour}})
	for i := range 3 {
		if ok, _ := l.Allow("u1"); !ok {
			t.Fatalf("call %d refused, want allowed", i+1)
		}
	}
	ok, wait := l.Allow("u1")
	if ok {
		t.Fatal("4th call allowed, want refused")
	}
	if wait != time.Hour {
		t.Fatalf("wait = %v, want 1h (all three calls were at the same instant)", wait)
	}
}

func TestRateLimiterIsPerUser(t *testing.T) {
	l, _ := newTestLimiter([]RateRule{{Max: 1, Window: time.Hour}})
	if ok, _ := l.Allow("u1"); !ok {
		t.Fatal("u1 first call refused")
	}
	if ok, _ := l.Allow("u2"); !ok {
		t.Fatal("u2 refused because of u1's usage")
	}
}

func TestRateLimiterSlidingWindowFreesOldestCall(t *testing.T) {
	l, clock := newTestLimiter([]RateRule{{Max: 2, Window: time.Hour}})
	l.Allow("u1") // 12:00
	clock.advance(20 * time.Minute)
	l.Allow("u1") // 12:20
	clock.advance(10 * time.Minute)
	if ok, wait := l.Allow("u1"); ok || wait != 30*time.Minute {
		t.Fatalf("at 12:30 got ok=%v wait=%v, want refused with 30m wait (12:00 call ages out at 13:00)", ok, wait)
	}
	clock.advance(30*time.Minute + time.Second)
	if ok, _ := l.Allow("u1"); !ok {
		t.Fatal("after the 12:00 call aged out, call still refused")
	}
}

func TestRateLimiterRefusedCallsDontExtendTheLimit(t *testing.T) {
	l, clock := newTestLimiter([]RateRule{{Max: 1, Window: time.Hour}})
	l.Allow("u1")
	for range 50 {
		clock.advance(time.Minute)
		l.Allow("u1") // all refused
	}
	clock.advance(11 * time.Minute) // 61 minutes after the only allowed call
	if ok, _ := l.Allow("u1"); !ok {
		t.Fatal("refused calls extended the window")
	}
}

func TestRateLimiterMultipleRulesLongestWaitWins(t *testing.T) {
	l, clock := newTestLimiter([]RateRule{{Max: 2, Window: time.Hour}, {Max: 3, Window: 24 * time.Hour}})
	l.Allow("u1")
	l.Allow("u1")
	clock.advance(time.Hour)
	if ok, _ := l.Allow("u1"); !ok {
		t.Fatal("hourly window reset but call refused")
	}
	clock.advance(time.Hour)
	ok, wait := l.Allow("u1")
	if ok {
		t.Fatal("4th call in a day allowed, want refused by the daily rule")
	}
	if wait != 22*time.Hour {
		t.Fatalf("wait = %v, want 22h (first call ages out of the day window)", wait)
	}
}

func TestRateLimiterGlobalCeilingAcrossUsers(t *testing.T) {
	l, _ := newTestLimiter([]RateRule{{Max: 5, Window: time.Hour}}, RateRule{Max: 2, Window: time.Hour})
	l.Allow("u1")
	l.Allow("u2")
	if ok, _ := l.Allow("u3"); ok {
		t.Fatal("global ceiling of 2 exceeded by a third user")
	}
}

func TestRateLimiterGCKeepsLimitsAccurate(t *testing.T) {
	l, clock := newTestLimiter([]RateRule{{Max: 1, Window: 10 * time.Minute}})
	l.Allow("u1")
	clock.advance(2 * time.Minute)
	l.Allow("other") // triggers gc; u1's call is still inside its window
	if ok, _ := l.Allow("u1"); ok {
		t.Fatal("gc dropped a call that was still inside its window")
	}
	clock.advance(20 * time.Minute)
	l.Allow("other")
	if _, exists := l.hits["u1"]; exists {
		t.Fatal("gc kept a key with no calls in its window")
	}
}

func TestRateLimiterWrapAnswers429(t *testing.T) {
	l, _ := newTestLimiter([]RateRule{{Max: 1, Window: time.Hour}})
	h := l.Wrap(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) { w.WriteHeader(http.StatusNoContent) }))
	req := httptest.NewRequest(http.MethodPost, "/x", nil)
	req = req.WithContext(context.WithValue(req.Context(), userIDContextKey, "u1"))

	rec := httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusNoContent {
		t.Fatalf("first call status %d, want 204", rec.Code)
	}
	rec = httptest.NewRecorder()
	h.ServeHTTP(rec, req)
	if rec.Code != http.StatusTooManyRequests {
		t.Fatalf("second call status %d, want 429", rec.Code)
	}
	if rec.Header().Get("Retry-After") != "3600" {
		t.Fatalf("Retry-After = %q, want 3600", rec.Header().Get("Retry-After"))
	}
}

func TestHumanWait(t *testing.T) {
	for _, c := range []struct {
		d    time.Duration
		want string
	}{
		{30 * time.Second, "in a minute"},
		{14*time.Minute + time.Second, "in 15 minutes"},
		{59 * time.Minute, "in about an hour"},
		{time.Hour, "in about an hour"},
		{22 * time.Hour, "in about 22 hours"},
	} {
		if got := humanWait(c.d); got != c.want {
			t.Errorf("humanWait(%v) = %q, want %q", c.d, got, c.want)
		}
	}
}
