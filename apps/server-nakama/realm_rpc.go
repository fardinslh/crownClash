package main

import (
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"net/http"
	"regexp"
	"strings"

	"github.com/heroiclabs/nakama-common/runtime"
)

type pilotRuntimeConfig struct {
	RefundSecret    string
	Enabled         bool
	PaymentsEnabled bool
	BotUsername     string
	WalletToken     string
	WebhookSecret   string
}

var pilotRuntime pilotRuntimeConfig

var pilotSafeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,80}$`)

type realmRPCRequest struct {
	RealmStartRequest
	MatchID   string      `json:"matchId"`
	Actions   []PvpAction `json:"actions"`
	Goal      string      `json:"goal"`
	OrderID   string      `json:"orderId"`
	ProductID string      `json:"productId"`
	VisitID   string      `json:"visitId"`
	Campaign  string      `json:"campaign"`
	EventID   string      `json:"eventId"`
	Name      string      `json:"name"`
	Reference string      `json:"reference"`
}

func pilotAccount(ctx context.Context, nk runtime.NakamaModule, user string) (platformIdentity, error) {
	a, err := nk.AccountGetId(ctx, user)
	if err != nil {
		return platformIdentity{}, errors.New("pilot_account_unavailable")
	}
	return identityFromUsername(a.CustomId), nil
}
func registerRealmRPCs(initializer runtime.Initializer, s *Store) error {
	methods := []string{"config", "home", "challenge/create", "challenge/resolve", "attack/start", "attack/settle", "attack/abandon", "goal", "shop", "order/create", "order/get", "entry", "event", "live/loadout"}
	for _, method := range methods {
		method := method
		if err := initializer.RegisterRpc("pilot/"+method, func(ctx context.Context, logger runtime.Logger, db *sql.DB, nk runtime.NakamaModule, payload string) (string, error) {
			user, _ := ctx.Value(runtime.RUNTIME_CTX_USER_ID).(string)
			if user == "" {
				return "", runtime.NewError("unauthenticated", 16)
			}
			account, err := pilotAccount(ctx, nk, user)
			if err != nil {
				return "", runtime.NewError(err.Error(), 13)
			}
			permitted := account.Platform == "bale" || (account.Platform == "browser" && serverConfig.AllowGuestAuth)
			enabled := pilotRuntime.Enabled && permitted
			payments := enabled && pilotRuntime.PaymentsEnabled && account.Platform == "bale" && pilotRuntime.WalletToken != "" && serverConfig.BaleBotToken != "" && len(pilotRuntime.WebhookSecret) >= 32 && pilotSafeID.MatchString(pilotRuntime.WebhookSecret)
			if method == "config" {
				return marshalJSON(map[string]any{"enabled": enabled, "paymentsEnabled": payments, "version": realmConfigVersion, "botUsername": pilotRuntime.BotUsername, "products": pilotCoinProducts})
			}
			if !enabled {
				return "", runtime.NewError("pilot_disabled", 9)
			}
			if len(payload) > 65536 {
				return "", runtime.NewError("invalid_payload", 3)
			}
			var req realmRPCRequest
			if payload != "" {
				if err = json.Unmarshal([]byte(payload), &req); err != nil {
					return "", runtime.NewError("invalid_payload", 3)
				}
			}
			var out any
			switch method {
			case "live/loadout":
				err = s.SetPilotLiveLoadout(ctx, user, req.CommanderID)
				out = map[string]bool{"ok": err == nil}
			case "home":
				var home RealmHome
				home, err = s.RealmHome(ctx, user)
				if err == nil && ((home.ActiveTicket != nil && !clientSupportsRules(req.SupportedGameplayRulesVersions, home.ActiveTicket.GameplayRulesVersion)) || (home.ActivePractice != nil && !clientSupportsRules(req.SupportedGameplayRulesVersions, home.ActivePractice.GameplayRulesVersion))) {
					err = errors.New("client_update_required")
				}
				out = home
			case "challenge/create":
				var token string
				var expires int64
				token, expires, err = s.CreateRealmChallengeWithCommander(ctx, user, req.CommanderID)
				out = map[string]any{"token": token, "expiresAt": expires}
			case "challenge/resolve":
				out, err = s.ResolveRealmChallenge(ctx, user, req.Token)
			case "attack/start":
				out, err = s.StartRealmAttack(ctx, user, req.RealmStartRequest)
			case "attack/settle":
				out, err = s.SettleRealmAttack(ctx, user, req.MatchID, req.Actions)
			case "attack/abandon":
				err = s.AbandonRealmAttack(ctx, user, req.MatchID)
				out = map[string]bool{"ok": err == nil}
			case "goal":
				err = s.SetRealmGoal(ctx, user, req.Goal)
				out = map[string]bool{"ok": err == nil}
			case "shop":
				var c PlayerCareer
				c, err = s.GetOrCreateCareer(ctx, user)
				var viewed int64
				var starter bool
				if err == nil {
					err = s.db.QueryRowContext(ctx, `SELECT COALESCE((SELECT viewed_at FROM realm_goals WHERE player_id=$1),0),EXISTS(SELECT 1 FROM coin_orders WHERE player_id=$1 AND product_id='starter' AND state IN ('fulfilled','refunded'))`, user).Scan(&viewed, &starter)
				}
				products := []CoinProduct{}
				for _, p := range pilotCoinProducts {
					if !p.Once || !starter {
						products = append(products, p)
					}
				}
				out = map[string]any{"enabled": payments, "eligible": c.TutorialCompleted && c.MatchesPlayed >= 3 && viewed > 0, "products": products}
			case "order/create":
				if !payments {
					return "", runtime.NewError("payments_disabled", 9)
				}
				if !pilotSafeID.MatchString(req.OrderID) {
					return "", runtime.NewError("invalid_order_id", 3)
				}
				var o CoinOrder
				o, err = s.CreateCoinOrder(ctx, user, account.ExternalID, req.OrderID, req.ProductID)
				if err == nil {
					provider := &BalePaymentProvider{Token: serverConfig.BaleBotToken, WalletToken: pilotRuntime.WalletToken}
					o, err = s.EnsureCoinInvoice(ctx, user, o.ID, provider)
				}
				out = o
			case "order/get":
				if account.Platform != "bale" {
					return "", runtime.NewError("payments_disabled", 9)
				}
				out, err = s.RecoverCoinOrder(ctx, user, req.OrderID, &BalePaymentProvider{Token: serverConfig.BaleBotToken, WalletToken: pilotRuntime.WalletToken})
			case "entry":
				if !pilotSafeID.MatchString(req.VisitID) || !pilotSafeID.MatchString(req.Campaign) {
					return "", runtime.NewError("invalid_entry", 3)
				}
				_, err = s.db.ExecContext(ctx, `INSERT INTO pilot_visits(id,player_id,campaign,challenge_token) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO UPDATE SET player_id=$2 WHERE pilot_visits.player_id IS NULL OR pilot_visits.player_id=$2`, req.VisitID, user, req.Campaign, req.Token)
				out = map[string]bool{"ok": err == nil}
			case "event":
				valid := map[string]bool{"goal_viewed": true, "offer_viewed": true, "checkout_started": true, "checkout_cancelled": true, "checkout_failed": true, "share_prompt_viewed": true, "share_initiated": true, "challenge_viewed": true, "first_input": true, "realm_viewed": true}
				if !valid[req.Name] || !pilotSafeID.MatchString(req.EventID) || len(req.Reference) > 80 {
					return "", runtime.NewError("invalid_pilot_event", 3)
				}
				_, err = s.db.ExecContext(ctx, `INSERT INTO pilot_observations(id,player_id,name,reference) VALUES($1,$2,$3,$4) ON CONFLICT(id) DO NOTHING`, req.EventID, user, req.Name, req.Reference)
				out = map[string]bool{"ok": err == nil}
			}
			if err != nil {
				logger.WithFields(map[string]any{"operation": method, "reason": err.Error()}).Warn("pilot operation rejected")
				return "", runtime.NewError(pilotPublicError(err), 9)
			}
			return marshalJSON(out)
		}); err != nil {
			return err
		}
	}
	// An anonymous entry is only an acquisition observation, never identity or entitlement.
	if err := initializer.RegisterHttp("/pilot/entry", func(w http.ResponseWriter, r *http.Request) {
		if !pilotRuntime.Enabled {
			http.Error(w, "disabled", 503)
			return
		}
		var req realmRPCRequest
		if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 2048)).Decode(&req); err != nil || !pilotSafeID.MatchString(req.VisitID) || !pilotSafeID.MatchString(req.Campaign) {
			http.Error(w, "invalid", 400)
			return
		}
		_, err := s.db.ExecContext(r.Context(), `INSERT INTO pilot_visits(id,campaign,challenge_token) VALUES($1,$2,$3) ON CONFLICT(id) DO NOTHING`, req.VisitID, req.Campaign, req.Token)
		if err != nil {
			http.Error(w, "unavailable", 503)
			return
		}
		w.WriteHeader(204)
	}, http.MethodPost); err != nil {
		return err
	}
	// Separate operator credential: disabled unless explicitly configured.
	if len(pilotRuntime.RefundSecret) >= 32 && pilotSafeID.MatchString(pilotRuntime.RefundSecret) && pilotRuntime.RefundSecret != pilotRuntime.WebhookSecret {
		if err := initializer.RegisterHttp("/pilot/operator/"+pilotRuntime.RefundSecret, func(w http.ResponseWriter, r *http.Request) {
			var req struct {
				OrderID   string `json:"orderId"`
				Reference string `json:"reference"`
				Note      string `json:"note"`
			}
			if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 8192)).Decode(&req); err != nil || !pilotSafeID.MatchString(req.OrderID) || len(req.Reference) < 1 || len(req.Reference) > 256 || len(req.Note) < 1 || len(req.Note) > 4096 {
				http.Error(w, "invalid", 400)
				return
			}
			if err := s.RecordCoinRefund(r.Context(), req.OrderID, req.Reference, req.Note); err != nil {
				http.Error(w, pilotPublicError(err), 409)
				return
			}
			w.WriteHeader(204)
		}, http.MethodPost); err != nil {
			return err
		}
	}
	if len(pilotRuntime.WebhookSecret) >= 32 && pilotSafeID.MatchString(pilotRuntime.WebhookSecret) {
		return initializer.RegisterHttp("/pilot/bale/"+pilotRuntime.WebhookSecret, s.coinWebhook(&BalePaymentProvider{Token: serverConfig.BaleBotToken, WalletToken: pilotRuntime.WalletToken}), http.MethodPost)
	}
	return nil
}
func marshalJSON(value any) (string, error) { raw, err := json.Marshal(value); return string(raw), err }
func pilotPublicError(err error) string {
	text := err.Error()
	for _, prefix := range []string{"client_update_", "realm_", "coin_", "challenge_", "revenge_", "no_realm_", "defense_", "invalid_", "tutorial_", "payment_", "pvp_", "commander_"} {
		if strings.HasPrefix(text, prefix) && len(text) < 100 {
			return text
		}
	}
	return "pilot_unavailable"
}
