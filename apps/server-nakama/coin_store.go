package main

import (
	"context"
	"database/sql"
	"errors"
)

func readCoinOrder(ctx context.Context, q rowQuerier, user, id string) (CoinOrder, error) {
	var o CoinOrder
	var owner string
	err := q.QueryRowContext(ctx, `SELECT id,player_id,product_id,coins,amount_rials,state,invoice,created_at FROM coin_orders WHERE id=$1`, id).Scan(&o.ID, &owner, &o.Product.ID, &o.Product.Coins, &o.Product.AmountRials, &o.State, &o.Invoice, &o.CreatedAt)
	if errors.Is(err, sql.ErrNoRows) {
		return o, errors.New("coin_order_not_found")
	}
	if err != nil {
		return o, err
	}
	if owner != user {
		return o, errors.New("coin_order_ownership")
	}
	o.Product.Once = o.Product.ID == "starter"
	return o, nil
}
func (s *Store) CreateCoinOrder(ctx context.Context, user, external, id, productID string) (CoinOrder, error) {
	if len(id) < 16 || len(id) > 80 {
		return CoinOrder{}, errors.New("invalid_order_id")
	}
	var product CoinProduct
	for _, p := range pilotCoinProducts {
		if p.ID == productID {
			product = p
		}
	}
	if product.ID == "" {
		return CoinOrder{}, errors.New("invalid_coin_product")
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CoinOrder{}, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return CoinOrder{}, err
	}
	var exists bool
	err = tx.QueryRowContext(ctx, `SELECT EXISTS(SELECT 1 FROM coin_orders WHERE id=$1)`, id).Scan(&exists)
	if err != nil {
		return CoinOrder{}, err
	}
	if exists {
		o, err := readCoinOrder(ctx, tx, user, id)
		if err != nil {
			return o, err
		}
		if o.Product.ID != productID {
			return o, errors.New("coin_order_id_reused")
		}
		return o, tx.Commit()
	}
	var viewed int64
	err = tx.QueryRowContext(ctx, `SELECT viewed_at FROM realm_goals WHERE player_id=$1`, user).Scan(&viewed)
	if errors.Is(err, sql.ErrNoRows) || viewed == 0 || c.MatchesPlayed < 3 || !c.TutorialCompleted {
		return CoinOrder{}, errors.New("coin_shop_locked")
	}
	if err != nil {
		return CoinOrder{}, err
	}
	if product.Once {
		var prior string
		err = tx.QueryRowContext(ctx, `SELECT id FROM coin_orders WHERE player_id=$1 AND product_id='starter'`, user).Scan(&prior)
		if err == nil {
			o, err := readCoinOrder(ctx, tx, user, prior)
			if err != nil {
				return o, err
			}
			if o.State == "fulfilled" || o.State == "refunded" {
				return o, errors.New("coin_starter_already_purchased")
			}
			return o, tx.Commit()
		}
		if !errors.Is(err, sql.ErrNoRows) {
			return CoinOrder{}, err
		}
	}
	// A lost response or reopen must recover the pending refill, not issue a second invoice.
	var prior string
	err = tx.QueryRowContext(ctx, `SELECT id FROM coin_orders WHERE player_id=$1 AND product_id=$2 AND state IN ('created','pending') ORDER BY created_at DESC LIMIT 1`, user, productID).Scan(&prior)
	if err == nil {
		o, err := readCoinOrder(ctx, tx, user, prior)
		if err != nil {
			return o, err
		}
		return o, tx.Commit()
	}
	if !errors.Is(err, sql.ErrNoRows) {
		return CoinOrder{}, err
	}
	o := CoinOrder{ID: id, Product: product, State: "created", CreatedAt: s.nowFn().UnixMilli()}
	_, err = tx.ExecContext(ctx, `INSERT INTO coin_orders(id,player_id,external_id,product_id,coins,amount_rials,created_at,test_mode) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`, id, user, external, product.ID, product.Coins, product.AmountRials, o.CreatedAt, pilotRuntime.WalletToken == "WALLET-TEST-1111111111111111")
	if err != nil {
		return o, err
	}
	return o, tx.Commit()
}
func (s *Store) AttachCoinInvoice(ctx context.Context, user, id, invoice string) (CoinOrder, error) {
	if invoice == "" || len(invoice) > 4096 {
		return CoinOrder{}, errors.New("invalid_coin_invoice")
	}
	_, err := s.db.ExecContext(ctx, `UPDATE coin_orders SET invoice=$3,state='pending' WHERE id=$1 AND player_id=$2 AND state='created'`, id, user, invoice)
	if err != nil {
		return CoinOrder{}, err
	}
	return readCoinOrder(ctx, s.db, user, id)
}

type VerifiedCoinPayment struct {
	OrderID       string
	TransactionID string
	ExternalID    string
	AmountRials   int
	Currency      string
}

func validateCoinPayment(o CoinOrder, external string, p VerifiedCoinPayment) error {
	if p.OrderID != o.ID || p.TransactionID == "" || len(p.TransactionID) > 256 || p.ExternalID != external || p.AmountRials != o.Product.AmountRials || p.Currency != "IRR" {
		return errors.New("coin_payment_mismatch")
	}
	return nil
}

// Called only after a server-to-server provider inquiry confirms paid identity and amount.
func (s *Store) FulfillCoinOrder(ctx context.Context, p VerifiedCoinPayment) (CoinOrder, error) {
	var user string
	if err := s.db.QueryRowContext(ctx, `SELECT player_id FROM coin_orders WHERE id=$1`, p.OrderID).Scan(&user); err != nil {
		return CoinOrder{}, err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return CoinOrder{}, err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return CoinOrder{}, err
	}
	var external, state string
	var storedTx sql.NullString
	err = tx.QueryRowContext(ctx, `SELECT external_id,state,transaction_id FROM coin_orders WHERE id=$1 FOR UPDATE`, p.OrderID).Scan(&external, &state, &storedTx)
	if err != nil {
		return CoinOrder{}, err
	}
	o, err := readCoinOrder(ctx, tx, user, p.OrderID)
	if err != nil {
		return o, err
	}
	if err = validateCoinPayment(o, external, p); err != nil {
		return o, err
	}
	if state == "fulfilled" || state == "refunded" {
		if storedTx.String != p.TransactionID {
			return o, errors.New("coin_transaction_mismatch")
		}
		return o, tx.Commit()
	}
	if !storedTx.Valid || storedTx.String != p.TransactionID {
		return o, errors.New("coin_transaction_mismatch")
	}
	if state != "pending" {
		return o, errors.New("coin_invoice_not_ready")
	}
	if c.Coins > 2147483647-o.Product.Coins {
		return o, errors.New("coin_balance_limit")
	}
	previous := c.Coins
	c.Coins += o.Product.Coins
	if err = persistCareer(ctx, tx, c); err != nil {
		return o, err
	}
	if err = insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{{ID: "coin_order_" + o.ID, Player: user, Currency: "coins", Amount: o.Product.Coins, Reason: "coin_purchase", Source: o.ID, PreviousBalance: previous, ResultingBalance: c.Coins, Timestamp: s.nowFn().UnixMilli()}}); err != nil {
		return o, err
	}
	_, err = tx.ExecContext(ctx, `UPDATE coin_orders SET state='fulfilled',transaction_id=$2,fulfilled_at=$3 WHERE id=$1`, o.ID, p.TransactionID, s.nowFn().UnixMilli())
	if err != nil {
		return o, err
	}
	o.State = "fulfilled"
	return o, tx.Commit()
}

// Operator-only compensation after a confirmed provider refund. Spent coins require
// a documented support decision; this function never silently creates a negative balance.
func (s *Store) RecordCoinRefund(ctx context.Context, id, reference, note string) error {
	if reference == "" || note == "" {
		return errors.New("refund_evidence_required")
	}
	var user string
	if err := s.db.QueryRowContext(ctx, `SELECT player_id FROM coin_orders WHERE id=$1`, id).Scan(&user); err != nil {
		return err
	}
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()
	c, err := realmCareerForUpdate(ctx, tx, user)
	if err != nil {
		return err
	}
	o, err := readCoinOrder(ctx, tx, user, id)
	if err != nil {
		return err
	}
	if o.State == "refunded" {
		var existing string
		if err = tx.QueryRowContext(ctx, `SELECT refund_reference FROM coin_orders WHERE id=$1`, id).Scan(&existing); err != nil {
			return err
		}
		if existing != reference {
			return errors.New("refund_reference_mismatch")
		}
		return tx.Commit()
	}
	if o.State != "fulfilled" {
		return errors.New("refund_order_not_fulfilled")
	}
	amount := minInt(c.Coins, o.Product.Coins)
	previous := c.Coins
	c.Coins -= amount
	if err = persistCareer(ctx, tx, c); err != nil {
		return err
	}
	if err = insertLedgerEntries(ctx, tx, []EconomyLedgerEntry{{ID: "coin_refund_" + id, Player: user, Currency: "coins", Amount: -amount, Reason: "coin_refund", Source: id, PreviousBalance: previous, ResultingBalance: c.Coins, Timestamp: s.nowFn().UnixMilli()}}); err != nil {
		return err
	}
	_, err = tx.ExecContext(ctx, `UPDATE coin_orders SET state='refunded',refunded_at=$2,refund_reference=$3,refund_note=$4 WHERE id=$1`, id, s.nowFn().UnixMilli(), reference, note)
	if err != nil {
		return err
	}
	return tx.Commit()
}
