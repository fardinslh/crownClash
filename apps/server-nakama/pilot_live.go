package main

import (
	"context"
	"database/sql"
	"errors"
)

// Temporary loadouts never change owned progression.
func (s *Store) pilotLiveCareer(ctx context.Context, c PlayerCareer) (PlayerCareer, error) {
	c.StartingGarrisonLevel = 0
	c.ProductionLevel = 0
	c.ArmySpeedLevel = 0
	var commander string
	err := s.db.QueryRowContext(ctx, `SELECT commander_id FROM realm_live_loadouts WHERE player_id=$1`, c.PlayerID).Scan(&commander)
	if errors.Is(err, sql.ErrNoRows) {
		return c, nil
	}
	if err != nil {
		return c, err
	}
	c.SelectedCommanderID = commander
	return c, nil
}
func (s *Store) SetPilotLiveLoadout(ctx context.Context, user, commander string) error {
	if _, ok := CommanderUnlockLevel(commander); !ok {
		return ErrCommanderInvalid
	}
	_, err := s.db.ExecContext(ctx, `INSERT INTO realm_live_loadouts(player_id,commander_id) VALUES($1,$2) ON CONFLICT(player_id) DO UPDATE SET commander_id=$2`, user, commander)
	return err
}
