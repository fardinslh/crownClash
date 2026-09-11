package main

import "testing"

func TestLiveArmyIDsAreUniqueAcrossPlayers(t *testing.T) {
	startedAt := int64(1_725_000_000_000)
	playerID := liveArmyID(startedAt, TeamPlayer, 0)
	enemyID := liveArmyID(startedAt, TeamEnemy, 0)

	if playerID == enemyID {
		t.Fatalf("player and enemy dispatches shared army ID %q", playerID)
	}
}

func TestLiveMatchStartIDMatchesPlayerSettlementID(t *testing.T) {
	startedAt := int64(1_725_000_000_000)
	playerID := "player_123"
	settlementID := livePlayerMatchID(startedAt, playerID)
	state := liveMatchState{
		startedAt: startedAt,
		players: [liveMaxPlayers]*livePlayerState{{
			userID: playerID, displayName: "Player", role: TeamPlayer,
		}},
	}
	startID, ok := state.matchStartedPayload(state.players[0])["matchId"].(string)

	if !ok || startID != settlementID {
		t.Fatalf("live start ID %q did not match settlement ID %q", startID, settlementID)
	}
	if startID != "live_1725000000000_player_123" {
		t.Fatalf("unexpected canonical live match ID %q", startID)
	}
}

func TestStateForEnemyRoleProjectsBothArmyOwners(t *testing.T) {
	state := GameState{
		BattlefieldID: "royal_ring",
		Armies: []MarchingArmy{
			{ID: liveArmyID(100, TeamPlayer, 0), Owner: TeamPlayer},
			{ID: liveArmyID(100, TeamEnemy, 0), Owner: TeamEnemy},
		},
	}

	projected := stateForRole(state, TeamEnemy)
	if projected.BattlefieldID != "royal_ring" {
		t.Fatalf("enemy projection lost battlefield ID: %q", projected.BattlefieldID)
	}
	if projected.Armies[0].Owner != TeamEnemy {
		t.Fatalf("expected opponent army to project as enemy, got %q", projected.Armies[0].Owner)
	}
	if projected.Armies[1].Owner != TeamPlayer {
		t.Fatalf("expected local army to project as player, got %q", projected.Armies[1].Owner)
	}
	if projected.Armies[0].ID == projected.Armies[1].ID {
		t.Fatalf("projected armies shared ID %q", projected.Armies[0].ID)
	}
}

func TestForfeitStatusAwardsVictoryToRemainingPlayer(t *testing.T) {
	for _, test := range []struct {
		name          string
		leaverRole    Team
		remainingRole Team
	}{
		{name: "canonical player leaves", leaverRole: TeamPlayer, remainingRole: TeamEnemy},
		{name: "canonical enemy leaves", leaverRole: TeamEnemy, remainingRole: TeamPlayer},
	} {
		t.Run(test.name, func(t *testing.T) {
			canonical := canonicalForfeitStatus(test.leaverRole)
			if leaverStatus := statusForRole(canonical, test.leaverRole); leaverStatus != "defeat" {
				t.Fatalf("expected leaver to get defeat, got %q", leaverStatus)
			}
			if remainingStatus := statusForRole(canonical, test.remainingRole); remainingStatus != "victory" {
				t.Fatalf("expected remaining player to get victory, got %q", remainingStatus)
			}
		})
	}
}
