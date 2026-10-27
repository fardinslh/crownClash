package main

import "testing"

func TestLevelsCompletedAfter(t *testing.T) {
	cases := []struct{ completed, level, want int }{
		{0, 1, 1},
		{1, 2, 2},
		{5, 2, 5},  // replay of an earlier level
		{5, 5, 5},  // repeat is idempotent
		{1, 4, 1},  // cannot skip ahead
		{0, 0, 0},  // invalid
		{0, -3, 0}, // invalid
		{levelCount, levelCount, levelCount},
		{levelCount, levelCount + 1, levelCount},
		{levelCount - 1, levelCount, levelCount},
	}
	for _, c := range cases {
		if got := levelsCompletedAfter(c.completed, c.level); got != c.want {
			t.Errorf("levelsCompletedAfter(%d, %d) = %d, want %d", c.completed, c.level, got, c.want)
		}
	}
}

func TestLevelAnalyticsValidation(t *testing.T) {
	valid := func(name string, levelID any) bool {
		props := map[string]any{"levelId": levelID}
		if name != "level_started" {
			props["durationSeconds"] = float64(30)
		}
		return validateAnalyticsEvent(analyticsTestEvent(name, props), analyticsTestNow) == nil
	}
	for _, name := range []string{"level_started", "level_completed", "level_failed"} {
		if !valid(name, float64(1)) || !valid(name, float64(levelCount)) {
			t.Errorf("%s should accept levels 1..%d", name, levelCount)
		}
		for _, bad := range []any{float64(0), float64(levelCount + 1), 1.5, "1", nil} {
			if valid(name, bad) {
				t.Errorf("%s should reject levelId %v", name, bad)
			}
		}
	}
}
