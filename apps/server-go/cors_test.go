package main

import (
	"net/http"
	"net/http/httptest"
	"testing"
)

func TestDevelopmentCORSAllowsGamePorts(t *testing.T) {
	t.Setenv("CLIENT_ORIGINS", "")
	config := LoadConfig()
	for _, origin := range []string{"http://localhost:3001", "http://localhost:3002"} {
		t.Run(origin, func(t *testing.T) {
			request := httptest.NewRequest(http.MethodOptions, "/auth/login", nil)
			request.Header.Set("Origin", origin)
			request.Header.Set("Access-Control-Request-Method", http.MethodPost)
			request.Header.Set("Access-Control-Request-Headers", "content-type")
			response := httptest.NewRecorder()

			NewServer(config, nil).Handler().ServeHTTP(response, request)

			if response.Code != http.StatusNoContent {
				t.Fatalf("expected 204 preflight response, got %d", response.Code)
			}
			if response.Header().Get("Access-Control-Allow-Origin") != origin {
				t.Fatalf("expected %s to be allowed, got %q", origin, response.Header().Get("Access-Control-Allow-Origin"))
			}
		})
	}
}
