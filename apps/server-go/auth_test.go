package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"strconv"
	"testing"
	"time"
)

func TestTelegramInitDataVerification(t *testing.T) {
	botToken := "test-token"
	params := url.Values{
		"auth_date": {strconv.FormatInt(time.Now().Unix(), 10)},
		"user":      {`{"id":42,"username":"commander"}`},
	}
	dataCheckString := "auth_date=" + params.Get("auth_date") + "\nuser=" + params.Get("user")
	secret := hmac.New(sha256.New, []byte("WebAppData"))
	secret.Write([]byte(botToken))
	check := hmac.New(sha256.New, secret.Sum(nil))
	check.Write([]byte(dataCheckString))
	params.Set("hash", hex.EncodeToString(check.Sum(nil)))

	verified, err := VerifyTelegramStyleInitData(params.Encode(), botToken, 60)
	if err != nil {
		t.Fatal(err)
	}
	if verified.UserID != "42" || verified.Username != "commander" {
		t.Fatalf("unexpected verified user: %+v", verified)
	}
}

func TestTelegramInitDataRejectsTampering(t *testing.T) {
	raw := "auth_date=1&user=%7B%22id%22%3A42%7D&hash=0000"
	params, _ := url.ParseQuery(raw)
	if _, err := VerifyTelegramStyleInitData(params.Encode(), "test-token", 0); err != ErrInvalidSignature {
		t.Fatalf("expected invalid signature, got %v", err)
	}
}
