package main

import (
	"os"
	"strconv"
	"strings"
)

type Config struct {
	Port                  string
	DatabaseURL           string
	JWTSecret             string
	NodeEnv               string
	ClientOrigins         map[string]bool
	AllowGuestAuth        bool
	TelegramBotToken      string
	BaleBotToken          string
	InitDataMaxAgeSeconds int64
}

func LoadConfig() Config {
	nodeEnv := getenv("NODE_ENV", "development")
	allowGuest := nodeEnv != "production"
	if value, ok := os.LookupEnv("ALLOW_GUEST_AUTH"); ok {
		allowGuest = value == "true"
	}
	maxAge := int64(86400)
	if value, err := strconv.ParseInt(os.Getenv("INIT_DATA_MAX_AGE_SECONDS"), 10, 64); err == nil && value != 0 {
		maxAge = value
	}
	origins := map[string]bool{}
	for _, origin := range strings.Split(getenv("CLIENT_ORIGINS", "http://localhost:3000,http://127.0.0.1:3000,http://localhost:5173,http://127.0.0.1:5173,http://localhost:3002,http://127.0.0.1:3002"), ",") {
		if trimmed := strings.TrimSpace(origin); trimmed != "" {
			origins[trimmed] = true
		}
	}
	return Config{
		Port:                  getenv("PORT", "8787"),
		DatabaseURL:           os.Getenv("DATABASE_URL"),
		JWTSecret:             getenv("JWT_SECRET", "dev-insecure-secret-change-me"),
		NodeEnv:               nodeEnv,
		ClientOrigins:         origins,
		AllowGuestAuth:        allowGuest,
		TelegramBotToken:      os.Getenv("TELEGRAM_BOT_TOKEN"),
		BaleBotToken:          os.Getenv("BALE_BOT_TOKEN"),
		InitDataMaxAgeSeconds: maxAge,
	}
}

func getenv(key, fallback string) string {
	if value := os.Getenv(key); value != "" {
		return value
	}
	return fallback
}
