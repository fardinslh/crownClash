package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func authVars(t *testing.T, platform, userID, username string) map[string]string {
	t.Helper()
	user, err := json.Marshal(map[string]string{
		"id":       userID,
		"username": username,
	})
	if err != nil {
		t.Fatal(err)
	}
	return map[string]string{
		"platform": platform,
		"init_data": url.Values{
			"auth_date": {strconv.FormatInt(time.Now().Unix(), 10)},
			"user":      {string(user)},
			"hash":      {"dev_mock_hash"},
		}.Encode(),
	}
}

func signedTelegramAuthVars(t *testing.T, userID, botToken string) map[string]string {
	t.Helper()
	user, err := json.Marshal(map[string]any{
		"id":         userID,
		"username":   "verified_user",
		"first_name": "Verified",
	})
	if err != nil {
		t.Fatal(err)
	}
	authDate := strconv.FormatInt(time.Now().Unix(), 10)
	dataCheckString := "auth_date=" + authDate + "\nuser=" + string(user)
	secretHMAC := hmac.New(sha256.New, []byte("WebAppData"))
	secretHMAC.Write([]byte(botToken))
	hashHMAC := hmac.New(sha256.New, secretHMAC.Sum(nil))
	hashHMAC.Write([]byte(dataCheckString))

	return map[string]string{
		"platform": "telegram",
		"init_data": url.Values{
			"auth_date": {authDate},
			"user":      {string(user)},
			"hash":      {hex.EncodeToString(hashHMAC.Sum(nil))},
		}.Encode(),
	}
}

func TestValidatePlatformIdentityAcceptsMatchingBrowserGuest(t *testing.T) {
	previousConfig := serverConfig
	serverConfig.AllowGuestAuth = true
	defer func() { serverConfig = previousConfig }()

	identity, err := validatePlatformIdentity(
		"browser:guest_1234",
		authVars(t, "browser", "guest_1234", "Commander_1234"),
	)
	if err != nil {
		t.Fatal(err)
	}
	if identity.ExternalID != "guest_1234" || identity.DisplayName != "Commander_1234" {
		t.Fatalf("unexpected identity: %+v", identity)
	}
}

func TestValidatePlatformIdentityRejectsMismatchedBrowserGuest(t *testing.T) {
	previousConfig := serverConfig
	serverConfig.AllowGuestAuth = true
	defer func() { serverConfig = previousConfig }()

	_, err := validatePlatformIdentity(
		"browser:guest_attacker",
		authVars(t, "browser", "guest_victim", "Victim"),
	)
	if err == nil || err.Error() != "identity_mismatch" {
		t.Fatalf("expected identity_mismatch, got %v", err)
	}
}

func TestValidatePlatformIdentityRejectsGuestWhenDisabled(t *testing.T) {
	previousConfig := serverConfig
	serverConfig.AllowGuestAuth = false
	defer func() { serverConfig = previousConfig }()

	_, err := validatePlatformIdentity(
		"browser:guest_1234",
		authVars(t, "browser", "guest_1234", "Commander_1234"),
	)
	if err == nil || err.Error() != "guest_auth_disabled" {
		t.Fatalf("expected guest_auth_disabled, got %v", err)
	}
}

func TestValidatePlatformIdentityVerifiesTelegramUserID(t *testing.T) {
	previousConfig := serverConfig
	serverConfig.TelegramBotToken = "test_bot_token"
	serverConfig.InitDataMaxAge = 60
	defer func() { serverConfig = previousConfig }()

	vars := signedTelegramAuthVars(t, "42", serverConfig.TelegramBotToken)
	identity, err := validatePlatformIdentity("telegram:42", vars)
	if err != nil {
		t.Fatal(err)
	}
	if identity.Username != "verified_user" || identity.DisplayName != "Verified" {
		t.Fatalf("unexpected identity: %+v", identity)
	}

	_, err = validatePlatformIdentity("telegram:43", vars)
	if err == nil || err.Error() != "identity_mismatch" {
		t.Fatalf("expected identity_mismatch, got %v", err)
	}
}
