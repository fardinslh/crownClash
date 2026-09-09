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

func TestStateForEnemyRoleProjectsBothArmyOwners(t *testing.T) {
	state := GameState{
		Armies: []MarchingArmy{
			{ID: liveArmyID(100, TeamPlayer, 0), Owner: TeamPlayer},
			{ID: liveArmyID(100, TeamEnemy, 0), Owner: TeamEnemy},
		},
	}

	projected := stateForRole(state, TeamEnemy)
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
