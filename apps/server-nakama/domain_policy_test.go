package main

import (
	"encoding/json"
	"testing"
)

// Recorded outputs of the pre-policy SettleMatch implementation
// (captured before the SettleMatchWithPolicy refactor). The refactor must be
// behavior-preserving: every future change to SettleMatch must reproduce
// these outputs byte-for-byte (deep-equal through JSON).
var golden1v1Settlements = map[string]string{
		"gold_a_defeat": "{\"matchId\":\"golden_gold_a\",\"status\":\"defeat\",\"breakdown\":{\"baseCoins\":10,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":0,\"totalCoins\":10,\"trophyDelta\":-12},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_a\",\"coins\":100,\"gems\":10,\"trophies\":0,\"startingGarrisonLevel\":0,\"productionLevel\":0,\"armySpeedLevel\":0,\"treasuryLevel\":0,\"selectedCommanderId\":\"crown_guard\",\"matchesPlayed\":0,\"matchesWon\":0,\"currentStreak\":0,\"bestStreak\":0,\"lastMatchTimestamp\":0},\"newCareer\":{\"playerId\":\"gold_a\",\"coins\":110,\"gems\":10,\"trophies\":0,\"startingGarrisonLevel\":0,\"productionLevel\":0,\"armySpeedLevel\":0,\"treasuryLevel\":0,\"selectedCommanderId\":\"crown_guard\",\"matchesPlayed\":1,\"matchesWon\":0,\"currentStreak\":0,\"bestStreak\":0,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"recruit\",\"name\":\"Recruit\",\"badge\":\"🛡️\",\"minTrophies\":0,\"maxTrophies\":99,\"color\":9741240},\"newRank\":{\"id\":\"recruit\",\"name\":\"Recruit\",\"badge\":\"🛡️\",\"minTrophies\":0,\"maxTrophies\":99,\"color\":9741240},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_a_coins_1725000100000\",\"player\":\"gold_a\",\"currency\":\"coins\",\"amount\":10,\"reason\":\"match_consolation\",\"source\":\"battle_settlement\",\"previousBalance\":100,\"resultingBalance\":110,\"timestamp\":1725000100000}]}",
		"gold_a_draw": "{\"matchId\":\"golden_gold_a\",\"status\":\"draw\",\"breakdown\":{\"baseCoins\":20,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":0,\"totalCoins\":20,\"trophyDelta\":5},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_a\",\"coins\":100,\"gems\":10,\"trophies\":0,\"startingGarrisonLevel\":0,\"productionLevel\":0,\"armySpeedLevel\":0,\"treasuryLevel\":0,\"selectedCommanderId\":\"crown_guard\",\"matchesPlayed\":0,\"matchesWon\":0,\"currentStreak\":0,\"bestStreak\":0,\"lastMatchTimestamp\":0},\"newCareer\":{\"playerId\":\"gold_a\",\"coins\":120,\"gems\":10,\"trophies\":5,\"startingGarrisonLevel\":0,\"productionLevel\":0,\"armySpeedLevel\":0,\"treasuryLevel\":0,\"selectedCommanderId\":\"crown_guard\",\"matchesPlayed\":1,\"matchesWon\":0,\"currentStreak\":0,\"bestStreak\":0,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"recruit\",\"name\":\"Recruit\",\"badge\":\"🛡️\",\"minTrophies\":0,\"maxTrophies\":99,\"color\":9741240},\"newRank\":{\"id\":\"recruit\",\"name\":\"Recruit\",\"badge\":\"🛡️\",\"minTrophies\":0,\"maxTrophies\":99,\"color\":9741240},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_a_coins_1725000100000\",\"player\":\"gold_a\",\"currency\":\"coins\",\"amount\":20,\"reason\":\"match_draw\",\"source\":\"battle_settlement\",\"previousBalance\":100,\"resultingBalance\":120,\"timestamp\":1725000100000},{\"id\":\"golden_gold_a_trophies_1725000100000\",\"player\":\"gold_a\",\"currency\":\"trophies\",\"amount\":5,\"reason\":\"rank_draw\",\"source\":\"battle_settlement\",\"previousBalance\":0,\"resultingBalance\":5,\"timestamp\":1725000100000}]}",
		"gold_a_victory": "{\"matchId\":\"golden_gold_a\",\"status\":\"victory\",\"breakdown\":{\"baseCoins\":40,\"speedBonus\":10,\"dominationBonus\":15,\"streakBonus\":0,\"treasuryBonus\":0,\"totalCoins\":65,\"trophyDelta\":30},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_a\",\"coins\":100,\"gems\":10,\"trophies\":0,\"startingGarrisonLevel\":0,\"productionLevel\":0,\"armySpeedLevel\":0,\"treasuryLevel\":0,\"selectedCommanderId\":\"crown_guard\",\"matchesPlayed\":0,\"matchesWon\":0,\"currentStreak\":0,\"bestStreak\":0,\"lastMatchTimestamp\":0},\"newCareer\":{\"playerId\":\"gold_a\",\"coins\":165,\"gems\":10,\"trophies\":30,\"startingGarrisonLevel\":0,\"productionLevel\":0,\"armySpeedLevel\":0,\"treasuryLevel\":0,\"selectedCommanderId\":\"crown_guard\",\"matchesPlayed\":1,\"matchesWon\":1,\"currentStreak\":1,\"bestStreak\":1,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"recruit\",\"name\":\"Recruit\",\"badge\":\"🛡️\",\"minTrophies\":0,\"maxTrophies\":99,\"color\":9741240},\"newRank\":{\"id\":\"recruit\",\"name\":\"Recruit\",\"badge\":\"🛡️\",\"minTrophies\":0,\"maxTrophies\":99,\"color\":9741240},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_a_coins_1725000100000\",\"player\":\"gold_a\",\"currency\":\"coins\",\"amount\":65,\"reason\":\"match_victory\",\"source\":\"battle_settlement\",\"previousBalance\":100,\"resultingBalance\":165,\"timestamp\":1725000100000},{\"id\":\"golden_gold_a_trophies_1725000100000\",\"player\":\"gold_a\",\"currency\":\"trophies\",\"amount\":30,\"reason\":\"rank_victory\",\"source\":\"battle_settlement\",\"previousBalance\":0,\"resultingBalance\":30,\"timestamp\":1725000100000}]}",
		"gold_b_defeat": "{\"matchId\":\"golden_gold_b\",\"status\":\"defeat\",\"breakdown\":{\"baseCoins\":10,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":1,\"totalCoins\":11,\"trophyDelta\":-12},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_b\",\"coins\":250,\"gems\":5,\"trophies\":340,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":12,\"matchesWon\":7,\"currentStreak\":3,\"bestStreak\":5,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_b\",\"coins\":261,\"gems\":5,\"trophies\":328,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":13,\"matchesWon\":7,\"currentStreak\":0,\"bestStreak\":5,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"newRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_b_coins_1725000100000\",\"player\":\"gold_b\",\"currency\":\"coins\",\"amount\":11,\"reason\":\"match_consolation\",\"source\":\"battle_settlement\",\"previousBalance\":250,\"resultingBalance\":261,\"timestamp\":1725000100000},{\"id\":\"golden_gold_b_trophies_1725000100000\",\"player\":\"gold_b\",\"currency\":\"trophies\",\"amount\":-12,\"reason\":\"rank_defeat\",\"source\":\"battle_settlement\",\"previousBalance\":340,\"resultingBalance\":328,\"timestamp\":1725000100000}]}",
		"gold_b_draw": "{\"matchId\":\"golden_gold_b\",\"status\":\"draw\",\"breakdown\":{\"baseCoins\":20,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":2,\"totalCoins\":22,\"trophyDelta\":5},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_b\",\"coins\":250,\"gems\":5,\"trophies\":340,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":12,\"matchesWon\":7,\"currentStreak\":3,\"bestStreak\":5,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_b\",\"coins\":272,\"gems\":5,\"trophies\":345,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":13,\"matchesWon\":7,\"currentStreak\":0,\"bestStreak\":5,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"newRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_b_coins_1725000100000\",\"player\":\"gold_b\",\"currency\":\"coins\",\"amount\":22,\"reason\":\"match_draw\",\"source\":\"battle_settlement\",\"previousBalance\":250,\"resultingBalance\":272,\"timestamp\":1725000100000},{\"id\":\"golden_gold_b_trophies_1725000100000\",\"player\":\"gold_b\",\"currency\":\"trophies\",\"amount\":5,\"reason\":\"rank_draw\",\"source\":\"battle_settlement\",\"previousBalance\":340,\"resultingBalance\":345,\"timestamp\":1725000100000}]}",
		"gold_b_draw_lowstats": "{\"matchId\":\"golden_lowstats\",\"status\":\"draw\",\"breakdown\":{\"baseCoins\":20,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":2,\"totalCoins\":22,\"trophyDelta\":5},\"stats\":{\"matchDurationSeconds\":95,\"playerUnitsDispatched\":30,\"enemyUnitsDispatched\":30,\"territoriesCapturedByPlayer\":2,\"territoriesCapturedByEnemy\":2},\"previousCareer\":{\"playerId\":\"gold_b\",\"coins\":250,\"gems\":5,\"trophies\":340,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":12,\"matchesWon\":7,\"currentStreak\":3,\"bestStreak\":5,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_b\",\"coins\":272,\"gems\":5,\"trophies\":345,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":13,\"matchesWon\":7,\"currentStreak\":0,\"bestStreak\":5,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"newRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_lowstats_coins_1725000100000\",\"player\":\"gold_b\",\"currency\":\"coins\",\"amount\":22,\"reason\":\"match_draw\",\"source\":\"battle_settlement\",\"previousBalance\":250,\"resultingBalance\":272,\"timestamp\":1725000100000},{\"id\":\"golden_lowstats_trophies_1725000100000\",\"player\":\"gold_b\",\"currency\":\"trophies\",\"amount\":5,\"reason\":\"rank_draw\",\"source\":\"battle_settlement\",\"previousBalance\":340,\"resultingBalance\":345,\"timestamp\":1725000100000}]}",
		"gold_b_victory": "{\"matchId\":\"golden_gold_b\",\"status\":\"victory\",\"breakdown\":{\"baseCoins\":40,\"speedBonus\":10,\"dominationBonus\":15,\"streakBonus\":15,\"treasuryBonus\":8,\"totalCoins\":88,\"trophyDelta\":30},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_b\",\"coins\":250,\"gems\":5,\"trophies\":340,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":12,\"matchesWon\":7,\"currentStreak\":3,\"bestStreak\":5,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_b\",\"coins\":338,\"gems\":5,\"trophies\":370,\"startingGarrisonLevel\":3,\"productionLevel\":2,\"armySpeedLevel\":4,\"treasuryLevel\":2,\"selectedCommanderId\":\"vanguard\",\"matchesPlayed\":13,\"matchesWon\":8,\"currentStreak\":4,\"bestStreak\":5,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"newRank\":{\"id\":\"knight\",\"name\":\"Knight\",\"badge\":\"🎖️\",\"minTrophies\":250,\"maxTrophies\":499,\"color\":8490232},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_b_coins_1725000100000\",\"player\":\"gold_b\",\"currency\":\"coins\",\"amount\":88,\"reason\":\"match_victory\",\"source\":\"battle_settlement\",\"previousBalance\":250,\"resultingBalance\":338,\"timestamp\":1725000100000},{\"id\":\"golden_gold_b_trophies_1725000100000\",\"player\":\"gold_b\",\"currency\":\"trophies\",\"amount\":30,\"reason\":\"rank_victory\",\"source\":\"battle_settlement\",\"previousBalance\":340,\"resultingBalance\":370,\"timestamp\":1725000100000}]}",
		"gold_c_defeat": "{\"matchId\":\"golden_gold_c\",\"status\":\"defeat\",\"breakdown\":{\"baseCoins\":10,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":3,\"totalCoins\":13,\"trophyDelta\":-12},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_c\",\"coins\":1000,\"gems\":10,\"trophies\":1420,\"startingGarrisonLevel\":8,\"productionLevel\":8,\"armySpeedLevel\":8,\"treasuryLevel\":8,\"selectedCommanderId\":\"quartermaster\",\"matchesPlayed\":90,\"matchesWon\":55,\"currentStreak\":9,\"bestStreak\":14,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_c\",\"coins\":1013,\"gems\":10,\"trophies\":1408,\"startingGarrisonLevel\":8,\"productionLevel\":8,\"armySpeedLevel\":8,\"treasuryLevel\":8,\"selectedCommanderId\":\"quartermaster\",\"matchesPlayed\":91,\"matchesWon\":55,\"currentStreak\":0,\"bestStreak\":14,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"crown_lord\",\"name\":\"Crown Lord\",\"badge\":\"💎\",\"minTrophies\":1400,\"maxTrophies\":99999,\"color\":11032055},\"newRank\":{\"id\":\"crown_lord\",\"name\":\"Crown Lord\",\"badge\":\"💎\",\"minTrophies\":1400,\"maxTrophies\":99999,\"color\":11032055},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_c_coins_1725000100000\",\"player\":\"gold_c\",\"currency\":\"coins\",\"amount\":13,\"reason\":\"match_consolation\",\"source\":\"battle_settlement\",\"previousBalance\":1000,\"resultingBalance\":1013,\"timestamp\":1725000100000},{\"id\":\"golden_gold_c_trophies_1725000100000\",\"player\":\"gold_c\",\"currency\":\"trophies\",\"amount\":-12,\"reason\":\"rank_defeat\",\"source\":\"battle_settlement\",\"previousBalance\":1420,\"resultingBalance\":1408,\"timestamp\":1725000100000}]}",
		"gold_c_draw": "{\"matchId\":\"golden_gold_c\",\"status\":\"draw\",\"breakdown\":{\"baseCoins\":20,\"speedBonus\":0,\"dominationBonus\":0,\"streakBonus\":0,\"treasuryBonus\":6,\"totalCoins\":26,\"trophyDelta\":5},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_c\",\"coins\":1000,\"gems\":10,\"trophies\":1420,\"startingGarrisonLevel\":8,\"productionLevel\":8,\"armySpeedLevel\":8,\"treasuryLevel\":8,\"selectedCommanderId\":\"quartermaster\",\"matchesPlayed\":90,\"matchesWon\":55,\"currentStreak\":9,\"bestStreak\":14,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_c\",\"coins\":1026,\"gems\":10,\"trophies\":1425,\"startingGarrisonLevel\":8,\"productionLevel\":8,\"armySpeedLevel\":8,\"treasuryLevel\":8,\"selectedCommanderId\":\"quartermaster\",\"matchesPlayed\":91,\"matchesWon\":55,\"currentStreak\":0,\"bestStreak\":14,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"crown_lord\",\"name\":\"Crown Lord\",\"badge\":\"💎\",\"minTrophies\":1400,\"maxTrophies\":99999,\"color\":11032055},\"newRank\":{\"id\":\"crown_lord\",\"name\":\"Crown Lord\",\"badge\":\"💎\",\"minTrophies\":1400,\"maxTrophies\":99999,\"color\":11032055},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_c_coins_1725000100000\",\"player\":\"gold_c\",\"currency\":\"coins\",\"amount\":26,\"reason\":\"match_draw\",\"source\":\"battle_settlement\",\"previousBalance\":1000,\"resultingBalance\":1026,\"timestamp\":1725000100000},{\"id\":\"golden_gold_c_trophies_1725000100000\",\"player\":\"gold_c\",\"currency\":\"trophies\",\"amount\":5,\"reason\":\"rank_draw\",\"source\":\"battle_settlement\",\"previousBalance\":1420,\"resultingBalance\":1425,\"timestamp\":1725000100000}]}",
		"gold_c_victory": "{\"matchId\":\"golden_gold_c\",\"status\":\"victory\",\"breakdown\":{\"baseCoins\":40,\"speedBonus\":10,\"dominationBonus\":15,\"streakBonus\":25,\"treasuryBonus\":27,\"totalCoins\":117,\"trophyDelta\":30},\"stats\":{\"matchDurationSeconds\":47.5,\"playerUnitsDispatched\":120,\"enemyUnitsDispatched\":90,\"territoriesCapturedByPlayer\":6,\"territoriesCapturedByEnemy\":1},\"previousCareer\":{\"playerId\":\"gold_c\",\"coins\":1000,\"gems\":10,\"trophies\":1420,\"startingGarrisonLevel\":8,\"productionLevel\":8,\"armySpeedLevel\":8,\"treasuryLevel\":8,\"selectedCommanderId\":\"quartermaster\",\"matchesPlayed\":90,\"matchesWon\":55,\"currentStreak\":9,\"bestStreak\":14,\"lastMatchTimestamp\":1725000000000},\"newCareer\":{\"playerId\":\"gold_c\",\"coins\":1117,\"gems\":10,\"trophies\":1450,\"startingGarrisonLevel\":8,\"productionLevel\":8,\"armySpeedLevel\":8,\"treasuryLevel\":8,\"selectedCommanderId\":\"quartermaster\",\"matchesPlayed\":91,\"matchesWon\":56,\"currentStreak\":10,\"bestStreak\":14,\"lastMatchTimestamp\":1725000100000},\"previousRank\":{\"id\":\"crown_lord\",\"name\":\"Crown Lord\",\"badge\":\"💎\",\"minTrophies\":1400,\"maxTrophies\":99999,\"color\":11032055},\"newRank\":{\"id\":\"crown_lord\",\"name\":\"Crown Lord\",\"badge\":\"💎\",\"minTrophies\":1400,\"maxTrophies\":99999,\"color\":11032055},\"rankPromoted\":false,\"ledgerEntries\":[{\"id\":\"golden_gold_c_coins_1725000100000\",\"player\":\"gold_c\",\"currency\":\"coins\",\"amount\":117,\"reason\":\"match_victory\",\"source\":\"battle_settlement\",\"previousBalance\":1000,\"resultingBalance\":1117,\"timestamp\":1725000100000},{\"id\":\"golden_gold_c_trophies_1725000100000\",\"player\":\"gold_c\",\"currency\":\"trophies\",\"amount\":30,\"reason\":\"rank_victory\",\"source\":\"battle_settlement\",\"previousBalance\":1420,\"resultingBalance\":1450,\"timestamp\":1725000100000}]}",
}

func TestSettleMatch1v1GoldenOutputsUnchanged(t *testing.T) {
	careers := []PlayerCareer{
		{PlayerID: "gold_a", Coins: 100, Gems: 10, Trophies: 0, SelectedCommanderID: "crown_guard"},
		{PlayerID: "gold_b", Coins: 250, Gems: 5, Trophies: 340, StartingGarrisonLevel: 3, ProductionLevel: 2, ArmySpeedLevel: 4, TreasuryLevel: 2, SelectedCommanderID: "vanguard", MatchesPlayed: 12, MatchesWon: 7, CurrentStreak: 3, BestStreak: 5, LastMatchTimestamp: 1725000000000},
		{PlayerID: "gold_c", Coins: 1000, Gems: 10, Trophies: 1420, StartingGarrisonLevel: 8, ProductionLevel: 8, ArmySpeedLevel: 8, TreasuryLevel: 8, SelectedCommanderID: "quartermaster", MatchesPlayed: 90, MatchesWon: 55, CurrentStreak: 9, BestStreak: 14, LastMatchTimestamp: 1725000000000},
	}
	stats := MatchStats{MatchDurationSeconds: 47.5, PlayerUnitsDispatched: 120, EnemyUnitsDispatched: 90, TerritoriesCapturedByPlayer: 6, TerritoriesCapturedByEnemy: 1}
	lowStats := MatchStats{MatchDurationSeconds: 95, PlayerUnitsDispatched: 30, EnemyUnitsDispatched: 30, TerritoriesCapturedByPlayer: 2, TerritoriesCapturedByEnemy: 2}

	produced := map[string]MatchSettlement{}
	for _, career := range careers {
		for _, status := range []string{"victory", "defeat", "draw"} {
			produced[career.PlayerID+"_"+status] = SettleMatch(career, status, stats, "golden_"+career.PlayerID, 1725000100000)
		}
	}
	produced["gold_b_draw_lowstats"] = SettleMatch(careers[1], "draw", lowStats, "golden_lowstats", 1725000100000)

	for key, golden := range golden1v1Settlements {
		actual, ok := produced[key]
		if !ok {
			t.Fatalf("golden key %s not produced", key)
		}
		encoded, err := json.Marshal(actual)
		if err != nil {
			t.Fatalf("marshal %s: %v", key, err)
		}
		if string(encoded) != golden {
			t.Fatalf("1v1 settlement %s drifted from golden output:\n  got:  %s\n  want: %s", key, encoded, golden)
		}
	}
}

func TestSettleMatchWithPolicyCasualZeroTrophiesAllOutcomes(t *testing.T) {
	career := PlayerCareer{PlayerID: "p_casual", Coins: 100, Gems: 10, Trophies: 340, TreasuryLevel: 2, SelectedCommanderID: "crown_guard", CurrentStreak: 3, MatchesPlayed: 12, MatchesWon: 7}
	stats := MatchStats{MatchDurationSeconds: 30, PlayerUnitsDispatched: 100, EnemyUnitsDispatched: 40, TerritoriesCapturedByPlayer: 6, TerritoriesCapturedByEnemy: 1}

	for _, status := range []string{"victory", "defeat", "draw"} {
		settlement := SettleMatchWithPolicy(career, status, stats, "casual_match", 1725000100000, CasualPolicy)
		if settlement.Breakdown.TrophyDelta != 0 {
			t.Fatalf("casual %s trophy delta = %d, want 0", status, settlement.Breakdown.TrophyDelta)
		}
		if settlement.NewCareer.Trophies != career.Trophies {
			t.Fatalf("casual %s trophies changed: %d -> %d", status, career.Trophies, settlement.NewCareer.Trophies)
		}
		if settlement.PreviousCareer.Trophies != settlement.NewCareer.Trophies {
			t.Fatalf("casual %s previous/new trophy mismatch", status)
		}
		if settlement.RankPromoted {
			t.Fatalf("casual %s must never promote rank", status)
		}
		if settlement.NewRank.ID != settlement.PreviousRank.ID {
			t.Fatalf("casual %s rank changed: %s -> %s", status, settlement.PreviousRank.ID, settlement.NewRank.ID)
		}
		for _, entry := range settlement.LedgerEntries {
			if entry.Currency == "trophies" {
				t.Fatalf("casual %s wrote a trophy ledger entry", status)
			}
		}
	}
}

func TestSettleMatchWithPolicyCasualKeepsRankedCoinCalculation(t *testing.T) {
	career := PlayerCareer{PlayerID: "p_coins", Coins: 100, Gems: 10, Trophies: 200, TreasuryLevel: 4, SelectedCommanderID: "crown_guard", CurrentStreak: 2}
	stats := MatchStats{MatchDurationSeconds: 35, PlayerUnitsDispatched: 80, EnemyUnitsDispatched: 60, TerritoriesCapturedByPlayer: 5, TerritoriesCapturedByEnemy: 2}

	for _, status := range []string{"victory", "defeat", "draw"} {
		ranked := SettleMatchWithPolicy(career, status, stats, "ranked_m", 1725000100000, RankedPolicy)
		casual := SettleMatchWithPolicy(career, status, stats, "casual_m", 1725000100000, CasualPolicy)
		if ranked.Breakdown.TotalCoins != casual.Breakdown.TotalCoins {
			t.Fatalf("casual %s coins %d != ranked coins %d", status, casual.Breakdown.TotalCoins, ranked.Breakdown.TotalCoins)
		}
		if ranked.Breakdown.BaseCoins != casual.Breakdown.BaseCoins ||
			ranked.Breakdown.SpeedBonus != casual.Breakdown.SpeedBonus ||
			ranked.Breakdown.DominationBonus != casual.Breakdown.DominationBonus ||
			ranked.Breakdown.StreakBonus != casual.Breakdown.StreakBonus ||
			ranked.Breakdown.TreasuryBonus != casual.Breakdown.TreasuryBonus {
			t.Fatalf("casual %s coin breakdown diverged from ranked", status)
		}
		if ranked.NewCareer.Coins != casual.NewCareer.Coins {
			t.Fatalf("casual %s resulting coins diverged from ranked", status)
		}
	}
}

func TestSettleMatchWithPolicyAbandonedSlotReceivesDefeatConsolation(t *testing.T) {
	// The abandoned-slot rule (docs/2v2-architecture.md §5.3): a surrendered or
	// abandoned slot settles at the defeat tier — 10 base coins, no
	// speed/domination/streak bonuses — regardless of the team outcome. This
	// is implemented by settling the slot as a defeat with zeroed capture
	// stats under the casual policy.
	career := PlayerCareer{PlayerID: "p_abandoned", Coins: 100, Gems: 10, Trophies: 500, TreasuryLevel: 0, SelectedCommanderID: "crown_guard", CurrentStreak: 6}
	victoryStats := MatchStats{MatchDurationSeconds: 20, PlayerUnitsDispatched: 200, TerritoriesCapturedByPlayer: 8}

	settlement := SettleMatchWithPolicy(career, "defeat", MatchStats{MatchDurationSeconds: victoryStats.MatchDurationSeconds}, "abandoned_m", 1725000100000, CasualPolicy)
	if settlement.Breakdown.BaseCoins != 10 {
		t.Fatalf("abandoned consolation base coins = %d, want 10", settlement.Breakdown.BaseCoins)
	}
	if settlement.Breakdown.SpeedBonus != 0 || settlement.Breakdown.DominationBonus != 0 || settlement.Breakdown.StreakBonus != 0 {
		t.Fatalf("abandoned consolation must exclude bonuses: %+v", settlement.Breakdown)
	}
	if settlement.Breakdown.TrophyDelta != 0 || settlement.NewCareer.Trophies != career.Trophies {
		t.Fatalf("abandoned consolation must not change trophies")
	}
	if career.CurrentStreak != 6 {
		t.Fatalf("settlement must not mutate the input career")
	}
}
