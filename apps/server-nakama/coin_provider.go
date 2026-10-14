package main

import (
	"bytes"
	"context"
	"database/sql"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"time"
)

type BalePaymentProvider struct {
	Token       string
	WalletToken string
	Client      *http.Client
	BaseURL     string
}

func (p *BalePaymentProvider) call(ctx context.Context, method string, request, response any) error {
	raw, err := json.Marshal(request)
	if err != nil {
		return err
	}
	base := p.BaseURL
	if base == "" {
		base = "https://tapi.bale.ai"
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, base+"/bot"+p.Token+"/"+method, bytes.NewReader(raw))
	if err != nil {
		return errors.New("payment_provider_unavailable")
	}
	req.Header.Set("Content-Type", "application/json")
	client := p.Client
	if client == nil {
		client = &http.Client{Timeout: 8 * time.Second}
	}
	res, err := client.Do(req)
	if err != nil {
		return errors.New("payment_provider_unavailable")
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		return errors.New("payment_provider_unavailable")
	}
	var envelope struct {
		OK     bool            `json:"ok"`
		Result json.RawMessage `json:"result"`
	}
	if err = json.NewDecoder(io.LimitReader(res.Body, 65536)).Decode(&envelope); err != nil || !envelope.OK {
		return errors.New("payment_provider_rejected")
	}
	if response != nil {
		if err = json.Unmarshal(envelope.Result, response); err != nil {
			return errors.New("payment_provider_invalid_response")
		}
	}
	return nil
}
func (p *BalePaymentProvider) CreateInvoice(ctx context.Context, o CoinOrder) (string, error) {
	var invoice string
	err := p.call(ctx, "createInvoiceLink", map[string]any{"title": fmt.Sprintf("%d سکه Crown Clash", o.Product.Coins), "description": "سکه برای ارتقای ارتش و قلمرو", "payload": o.ID, "provider_token": p.WalletToken, "prices": []map[string]any{{"label": "سکه", "amount": o.Product.AmountRials}}}, &invoice)
	if err == nil && (invoice == "" || len(invoice) > 4096) {
		return "", errors.New("payment_provider_invalid_invoice")
	}
	return invoice, err
}

type BaleTransaction struct {
	ID     string      `json:"id"`
	Status string      `json:"status"`
	UserID json.Number `json:"userID"`
	Amount int         `json:"amount"`
}

func (p *BalePaymentProvider) Inquiry(ctx context.Context, id string) (BaleTransaction, error) {
	var t BaleTransaction
	err := p.call(ctx, "inquireTransaction", map[string]string{"transaction_id": id}, &t)
	if err != nil {
		return t, err
	}
	if t.ID != id {
		return t, errors.New("payment_transaction_mismatch")
	}
	return t, nil
}
func (s *Store) EnsureCoinInvoice(ctx context.Context, user, id string, p *BalePaymentProvider) (CoinOrder, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CoinOrder{}, err
	}
	defer tx.Rollback()
	var owner string
	err = tx.QueryRowContext(ctx, `SELECT player_id FROM coin_orders WHERE id=$1 FOR UPDATE`, id).Scan(&owner)
	if err != nil {
		return CoinOrder{}, err
	}
	if owner != user {
		return CoinOrder{}, errors.New("coin_order_ownership")
	}
	o, err := readCoinOrder(ctx, tx, user, id)
	if err != nil {
		return o, err
	}
	if o.State == "created" {
		invoice, err := p.CreateInvoice(ctx, o)
		if err != nil {
			return o, err
		}
		_, err = tx.ExecContext(ctx, `UPDATE coin_orders SET state='pending',invoice=$2 WHERE id=$1`, id, invoice)
		if err != nil {
			return o, err
		}
		o.Invoice = invoice
		o.State = "pending"
	}
	return o, tx.Commit()
}
func (s *Store) VerifyCoinReceipt(ctx context.Context, p *BalePaymentProvider, order, transaction, external string, amount int, currency string) (CoinOrder, error) {
	if order == "" || transaction == "" || len(transaction) > 256 {
		return CoinOrder{}, errors.New("invalid_coin_receipt")
	}
	t, err := p.Inquiry(ctx, transaction)
	if err != nil {
		return CoinOrder{}, err
	}
	if t.Status != "paid" || t.UserID.String() != external || t.Amount != amount || currency != "IRR" {
		return CoinOrder{}, errors.New("coin_payment_not_verified")
	}
	return s.FulfillCoinOrder(ctx, VerifiedCoinPayment{OrderID: order, TransactionID: transaction, ExternalID: external, AmountRials: amount, Currency: currency})
}
func (s *Store) coinWebhook(provider *BalePaymentProvider) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		var update struct {
			PreCheckout *struct {
				ID   string `json:"id"`
				From struct {
					ID int64 `json:"id"`
				} `json:"from"`
				Currency string `json:"currency"`
				Amount   int    `json:"total_amount"`
				Payload  string `json:"invoice_payload"`
			} `json:"pre_checkout_query"`
			Message *struct {
				From struct {
					ID int64 `json:"id"`
				} `json:"from"`
				Payment *struct {
					Currency    string `json:"currency"`
					Amount      int    `json:"total_amount"`
					Payload     string `json:"invoice_payload"`
					Transaction string `json:"telegram_payment_charge_id"`
				} `json:"successful_payment"`
			} `json:"message"`
		}
		if err := json.NewDecoder(io.LimitReader(r.Body, 16384)).Decode(&update); err != nil {
			http.Error(w, "invalid", 400)
			return
		}
		if q := update.PreCheckout; q != nil {
			ctx, cancel := context.WithTimeout(r.Context(), 9*time.Second)
			defer cancel()
			// This callback does not credit coins. Verification of the final transaction is mandatory.
			valid := pilotRuntime.PaymentsEnabled && s.bindCoinCheckout(ctx, provider, q.Payload, q.ID, strconv.FormatInt(q.From.ID, 10), q.Currency, q.Amount) == nil
			body := map[string]any{"pre_checkout_query_id": q.ID, "ok": valid}
			if !valid {
				body["error_message"] = "سفارش معتبر نیست؛ دوباره از فروشگاه بازی شروع کن."
			}
			if err := provider.call(ctx, "answerPreCheckoutQuery", body, nil); err != nil {
				http.Error(w, "retry", 503)
				return
			}
			w.WriteHeader(200)
			return
		}
		if update.Message == nil || update.Message.Payment == nil {
			w.WriteHeader(200)
			return
		}
		m := update.Message
		p := m.Payment
		if _, err := s.VerifyCoinReceipt(r.Context(), provider, p.Payload, p.Transaction, strconv.FormatInt(m.From.ID, 10), p.Amount, p.Currency); err != nil {
			http.Error(w, "unverified", 503)
			return
		}
		w.WriteHeader(200)
	}
}

// Bind the provider's pre-checkout transaction before approving it. The receipt
// must match this binding as well as the provider inquiry; another paid receipt
// with the same amount cannot be replayed against a different order.
func (s *Store) bindCoinCheckout(ctx context.Context, p *BalePaymentProvider, id, transaction, external, currency string, amount int) error {
	if transaction == "" || len(transaction) > 256 {
		return errors.New("invalid_coin_transaction")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	var owner, payer, state string
	var price int
	var prior sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT player_id,external_id,state,amount_rials,transaction_id FROM coin_orders WHERE id=$1 FOR UPDATE`, id).Scan(&owner, &payer, &state, &price, &prior)
	if err != nil {
		return err
	}
	if state != "pending" || payer != external || currency != "IRR" || price != amount {
		return errors.New("coin_payment_mismatch")
	}
	if prior.Valid && prior.String != transaction {
		old, err := p.Inquiry(ctx, prior.String)
		if err != nil {
			return err
		}
		if old.Status != "failed" && old.Status != "rejected" {
			return errors.New("coin_checkout_already_pending")
		}
	}
	_, err = tx.ExecContext(ctx, `UPDATE coin_orders SET transaction_id=$2 WHERE id=$1`, id, transaction)
	if err != nil {
		return err
	}
	return tx.Commit()
}
func (s *Store) RecoverCoinOrder(ctx context.Context, user, id string, p *BalePaymentProvider) (CoinOrder, error) {
	o, err := readCoinOrder(ctx, s.db, user, id)
	if err != nil || o.State != "pending" {
		return o, err
	}
	var transaction sql.NullString
	var external string
	if err = s.db.QueryRowContext(ctx, `SELECT transaction_id,external_id FROM coin_orders WHERE id=$1`, id).Scan(&transaction, &external); err != nil {
		return o, err
	}
	if !transaction.Valid {
		return o, nil
	}
	t, err := p.Inquiry(ctx, transaction.String)
	if err != nil {
		return o, err
	}
	if t.Status != "paid" {
		return o, nil
	}
	if t.UserID.String() != external || t.Amount != o.Product.AmountRials {
		return o, errors.New("coin_payment_mismatch")
	}
	return s.FulfillCoinOrder(ctx, VerifiedCoinPayment{OrderID: id, TransactionID: transaction.String, ExternalID: external, AmountRials: t.Amount, Currency: "IRR"})
}
