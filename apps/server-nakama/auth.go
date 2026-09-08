package main

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/url"
	"sort"
	"strconv"
	"strings"
	"time"
)

type VerifiedInitData struct {
	UserID       string
	Username     string
	FirstName    string
	LastName     string
	LanguageCode string
	AuthDate     int64
}

var (
	ErrMissingHash       = errors.New("missing_hash")
	ErrMissingAuthDate   = errors.New("missing_auth_date")
	ErrInvalidSignature  = errors.New("invalid_signature")
	ErrExpiredInitData   = errors.New("expired")
	ErrMissingUser       = errors.New("missing_user")
	ErrMalformedInitData = errors.New("malformed")
)

func VerifyTelegramStyleInitData(raw, botToken string, maxAgeSeconds int64) (VerifiedInitData, error) {
	params, err := url.ParseQuery(raw)
	if err != nil {
		return VerifiedInitData{}, ErrMalformedInitData
	}
	hash := params.Get("hash")
	if hash == "" {
		return VerifiedInitData{}, ErrMissingHash
	}
	authDateRaw := params.Get("auth_date")
	if authDateRaw == "" {
		return VerifiedInitData{}, ErrMissingAuthDate
	}
	authDate, err := strconv.ParseInt(authDateRaw, 10, 64)
	if err != nil {
		return VerifiedInitData{}, ErrMalformedInitData
	}
	if maxAgeSeconds > 0 && time.Now().Unix()-authDate > maxAgeSeconds {
		return VerifiedInitData{}, ErrExpiredInitData
	}
	keys := make([]string, 0, len(params))
	for key := range params {
		if key != "hash" {
			keys = append(keys, key)
		}
	}
	sort.Strings(keys)
	lines := make([]string, 0, len(keys))
	for _, key := range keys {
		for _, value := range params[key] {
			lines = append(lines, key+"="+value)
		}
	}
	dataCheckString := strings.Join(lines, "\n")
	secretHMAC := hmac.New(sha256.New, []byte("WebAppData"))
	secretHMAC.Write([]byte(botToken))
	secretKey := secretHMAC.Sum(nil)
	hashHMAC := hmac.New(sha256.New, secretKey)
	hashHMAC.Write([]byte(dataCheckString))
	expected := hashHMAC.Sum(nil)
	actual, err := hex.DecodeString(hash)
	if err != nil || !hmac.Equal(expected, actual) {
		return VerifiedInitData{}, ErrInvalidSignature
	}
	user, err := extractUser(params)
	if err != nil {
		return VerifiedInitData{}, err
	}
	return VerifiedInitData{
		UserID: user.ID, Username: user.Username, FirstName: user.FirstName,
		LastName: user.LastName, LanguageCode: user.LanguageCode, AuthDate: authDate,
	}, nil
}

type extractedUser struct {
	ID           string
	Username     string
	FirstName    string
	LastName     string
	LanguageCode string
}

func extractUser(params url.Values) (extractedUser, error) {
	raw := params.Get("user")
	if raw != "" {
		var value struct {
			ID           any    `json:"id"`
			Username     string `json:"username"`
			FirstName    string `json:"first_name"`
			LastName     string `json:"last_name"`
			LanguageCode string `json:"language_code"`
		}
		if err := json.Unmarshal([]byte(raw), &value); err == nil && value.ID != nil {
			return extractedUser{
				ID: stringifyUserID(value.ID), Username: value.Username,
				FirstName: value.FirstName, LastName: value.LastName,
				LanguageCode: value.LanguageCode,
			}, nil
		}
	}
	return extractedUser{}, ErrMissingUser
}

func ExtractUnverifiedUser(raw string) (string, string, bool) {
	params, err := url.ParseQuery(raw)
	if err != nil {
		return "", "", false
	}
	if user, err := extractUser(params); err == nil {
		return user.ID, user.Username, true
	}
	userID := params.Get("eitaa_id")
	if userID == "" {
		userID = params.Get("user_id")
	}
	if userID == "" {
		return "", "", false
	}
	return userID, params.Get("username"), true
}

func stringifyUserID(value any) string {
	switch typed := value.(type) {
	case string:
		return typed
	case float64:
		return strconv.FormatFloat(typed, 'f', -1, 64)
	default:
		return ""
	}
}
