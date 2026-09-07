package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDevelopmentCORSAllowsGamePort3002(t *testing.T) {
	t.Setenv("CLIENT_ORIGINS", "")
	config := LoadConfig()
	request := httptest.NewRequest(http.MethodOptions, "/auth/login", nil)
	request.Header.Set("Origin", "http://localhost:3002")
	request.Header.Set("Access-Control-Request-Method", http.MethodPost)
	request.Header.Set("Access-Control-Request-Headers", "content-type")
	response := httptest.NewRecorder()

	NewServer(config, nil).Handler().ServeHTTP(response, request)

	if response.Code != http.StatusNoContent {
		t.Fatalf("expected 204 preflight response, got %d", response.Code)
	}
	if response.Header().Get("Access-Control-Allow-Origin") != "http://localhost:3002" {
		t.Fatalf("expected localhost:3002 to be allowed, got %q", response.Header().Get("Access-Control-Allow-Origin"))
	}
}
