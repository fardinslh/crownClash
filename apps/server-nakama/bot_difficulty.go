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

// botCommanderID is the commander (and so the one ability) the bot brings to a
// v4 match. Easy stays ability-free. Mirrors BOT_COMMANDER in bot-difficulty.ts.
func botCommanderID(difficulty string) string {
	switch difficulty {
	case "normal":
		return "quartermaster"
	case "hard":
		return "vanguard"
	default:
		return ""
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
