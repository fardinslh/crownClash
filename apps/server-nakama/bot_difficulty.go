package main

import "errors"

// Pinned in the ticket; difficulty never changes troop or production modifiers.
func normalizeBotDifficulty(value string) (string, error) {
	if value == "" {
		return "normal", nil
	}
	switch value {
	case "easy", "normal", "hard":
		return value, nil
	default:
		return "", errors.New("invalid_bot_difficulty")
	}
}
func botAITickSeconds(difficulty string) float64 {
	switch difficulty {
	case "easy":
		return 3.6
	case "hard":
		return .9
	default:
		return PvpAITickSeconds
	}
}
