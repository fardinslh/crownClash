package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"testing"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

func TestPostgresAPIIntegration(t *testing.T) {
	databaseURL := os.Getenv("DATABASE_URL")
	if databaseURL == "" {
		t.Skip("DATABASE_URL is required")
	}
	ctx, cancel := context.WithTimeout(context.Background(), 20*time.Second)
	defer cancel()
	pool, err := pgxpool.New(ctx, databaseURL)
	if err != nil {
		t.Fatal(err)
	}
	defer pool.Close()
	if err := pool.Ping(ctx); err != nil {
		t.Fatal(err)
	}
	if err := RunMigrations(ctx, pool); err != nil {
		t.Fatal(err)
	}

	config := Config{
		DatabaseURL: databaseURL, JWTSecret: "integration-secret",
		ClientOrigins:  map[string]bool{"http://localhost:5173": true},
		AllowGuestAuth: true, InitDataMaxAgeSeconds: 86400,
	}
	server := httptest.NewServer(NewServer(config, NewPlayerRepository(pool)).Handler())
	defer server.Close()

	suffix := fmt.Sprintf("%d", time.Now().UnixNano())
	first := loginIntegrationPlayer(t, server.URL, "attacker_"+suffix)
	second := loginIntegrationPlayer(t, server.URL, "defender_"+suffix)

	opponents := doIntegrationRequest(t, server.URL+"/pvp/opponents", first.token, http.MethodGet, nil)
	if opponents.StatusCode != http.StatusOK {
		t.Fatalf("opponents status: %d", opponents.StatusCode)
	}
	var opponentBody struct {
		Opponents []PvpOpponent `json:"opponents"`
	}
	decodeIntegration(t, opponents, &opponentBody)
	found := false
	for _, opponent := range opponentBody.Opponents {
		if opponent.PlayerID == second.playerID {
			found = true
		}
	}
	if !found {
		t.Fatal("defender was not returned in opponent discovery")
	}

	purchasePayload := map[string]any{
		"type":       "starting_garrison",
		"purchaseId": "purchase_" + suffix,
	}
	start := make(chan struct{})
	statuses := make(chan int, 2)
	for range 2 {
		go func() {
			<-start
			response := doIntegrationRequest(t, server.URL+"/upgrades/purchase", first.token, http.MethodPost, purchasePayload)
			statuses <- response.StatusCode
			_ = response.Body.Close()
		}()
	}
	close(start)
	for range 2 {
		if status := <-statuses; status != http.StatusOK {
			t.Fatalf("concurrent idempotent purchase status: %d", status)
		}
	}
	careerResponse := doIntegrationRequest(t, server.URL+"/career", first.token, http.MethodGet, nil)
	if careerResponse.StatusCode != http.StatusOK {
		t.Fatalf("career status after purchase: %d", careerResponse.StatusCode)
	}
	var careerBody struct {
		Career PlayerCareer `json:"career"`
	}
	decodeIntegration(t, careerResponse, &careerBody)
	if careerBody.Career.Coins != 50 {
		t.Fatalf("concurrent purchase charged more than once: %+v", careerBody.Career)
	}

	attackPayload := map[string]any{
		"attackId":   "attack_" + suffix,
		"defenderId": second.playerID,
		"actions":    []PvpAction{},
	}
	firstAttack := doIntegrationRequest(t, server.URL+"/pvp/attacks", first.token, http.MethodPost, attackPayload)
	if firstAttack.StatusCode != http.StatusOK {
		t.Fatalf("attack status: %d", firstAttack.StatusCode)
	}
	var firstResult struct {
		Result PvpAttackResult `json:"result"`
	}
	decodeIntegration(t, firstAttack, &firstResult)
	secondAttack := doIntegrationRequest(t, server.URL+"/pvp/attacks", first.token, http.MethodPost, attackPayload)
	if secondAttack.StatusCode != http.StatusOK {
		t.Fatalf("idempotent attack status: %d", secondAttack.StatusCode)
	}
	var secondResult struct {
		Result PvpAttackResult `json:"result"`
	}
	decodeIntegration(t, secondAttack, &secondResult)
	if firstResult.Result.Settlement.NewCareer.Coins != secondResult.Result.Settlement.NewCareer.Coins {
		t.Fatal("idempotent attack returned a different settlement")
	}

	history := doIntegrationRequest(t, server.URL+"/pvp/history?limit=5", first.token, http.MethodGet, nil)
	if history.StatusCode != http.StatusOK {
		t.Fatalf("history status: %d", history.StatusCode)
	}
}

type integrationPlayer struct {
	token    string
	playerID string
}

func loginIntegrationPlayer(t *testing.T, baseURL, id string) integrationPlayer {
	t.Helper()
	body := map[string]string{
		"platform": "browser",
		"initData": "user=%7B%22id%22%3A%22" + id + "%22%7D",
	}
	response := doIntegrationRequest(t, baseURL+"/auth/login", "", http.MethodPost, body)
	if response.StatusCode != http.StatusOK {
		t.Fatalf("login status: %d", response.StatusCode)
	}
	var payload struct {
		Token string `json:"token"`
	}
	decodeIntegration(t, response, &payload)
	return integrationPlayer{token: payload.Token, playerID: "browser:" + id}
}

func doIntegrationRequest(t *testing.T, endpoint, token, method string, body any) *http.Response {
	t.Helper()
	var requestBody *bytes.Reader
	if body == nil {
		requestBody = bytes.NewReader(nil)
	} else {
		encoded, err := json.Marshal(body)
		if err != nil {
			t.Fatal(err)
		}
		requestBody = bytes.NewReader(encoded)
	}
	request, err := http.NewRequest(method, endpoint, requestBody)
	if err != nil {
		t.Fatal(err)
	}
	if body != nil {
		request.Header.Set("Content-Type", "application/json")
	}
	if token != "" {
		request.Header.Set("Authorization", "Bearer "+token)
	}
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		t.Fatal(err)
	}
	return response
}

func decodeIntegration(t *testing.T, response *http.Response, target any) {
	t.Helper()
	defer response.Body.Close()
	if err := json.NewDecoder(response.Body).Decode(target); err != nil {
		t.Fatal(err)
	}
}
