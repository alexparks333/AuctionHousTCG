package phoneverify

import "testing"

// TestNormalizeE164 is a regression test for a real, live-found bug: a
// plain 10-digit US number typed with no country code ("8188078706")
// reached Twilio's Verify API unmodified and was rejected outright
// ("Invalid parameter `To`: 8188078706").
func TestNormalizeE164(t *testing.T) {
	cases := map[string]string{
		"8188078706":       "+18188078706",
		"+18188078706":     "+18188078706",
		"18188078706":      "+18188078706",
		" (818) 807-8706 ": "+18188078706",
		"818-807-8706":     "+18188078706",
	}
	for in, want := range cases {
		if got := NormalizeE164(in); got != want {
			t.Errorf("NormalizeE164(%q) = %q, want %q", in, got, want)
		}
	}
}
