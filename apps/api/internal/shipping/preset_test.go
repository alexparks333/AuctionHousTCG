package shipping

import "testing"

func TestUpgradeForItemCount(t *testing.T) {
	tests := []struct {
		name   string
		preset Preset
		count  int
		want   Preset
	}{
		{"single card stays envelope", PresetTrackedEnvelope, 1, PresetTrackedEnvelope},
		{"at the cap stays envelope", PresetTrackedEnvelope, EnvelopeMaxCards, PresetTrackedEnvelope},
		{"past the cap becomes package", PresetTrackedEnvelope, EnvelopeMaxCards + 1, PresetShippoGroundAdvantage},
		{"free envelope past the cap becomes paid package", PresetFreeEnvelope, EnvelopeMaxCards + 1, PresetShippoGroundAdvantage},
		{"free bubble mailer is already a package", PresetFreeBubbleMailer, 50, PresetFreeBubbleMailer},
		{"paid package unchanged", PresetShippoGroundAdvantage, 50, PresetShippoGroundAdvantage},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := UpgradeForItemCount(tt.preset, tt.count); got != tt.want {
				t.Errorf("UpgradeForItemCount(%s, %d) = %s, want %s", tt.preset, tt.count, got, tt.want)
			}
		})
	}
}
