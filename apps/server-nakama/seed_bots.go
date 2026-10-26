package main

import (
	"context"
	"fmt"
)

// Seed opponents give a new game something to play against before it has a
// population. They are ordinary async defenders: a published Realm defense
// snapshot that real players attack. Rules that keep them honest:
//   - players.is_bot marks them, so every report can exclude them;
//   - they exist only as opponents: never in the trophies leaderboard, never
//     a revenge target, never a friend, never counted as online;
//   - real defenders within range are always preferred over a seed bot;
//   - they hold no coins or gems and have no ledger rows;
//   - ENABLE_SEED_BOTS=false hides them from matchmaking without deleting them.
type seedBot struct {
	ID       string
	Name     string
	Trophies int
}

// The names mix full Persian names, first name plus a handle, and Latin
// handles, because that is what real display names look like on Bale and
// Telegram. Trophies are dense near the start, where new players live.
var seedBotRoster = []seedBot{
	{"seedbot_01", "علی رضایی", 12},
	{"seedbot_02", "sara_m", 28},
	{"seedbot_03", "مهدی", 40},
	{"seedbot_04", "نگین احمدی", 58},
	{"seedbot_05", "arman.k", 74},
	{"seedbot_06", "پویا_گیمر", 92},
	{"seedbot_07", "Reza Karimi", 110},
	{"seedbot_08", "هانیه", 128},
	{"seedbot_09", "kian_2000", 150},
	{"seedbot_10", "امیرحسین", 168},
	{"seedbot_11", "ماهان صادقی", 190},
	{"seedbot_12", "Nika", 212},
	{"seedbot_13", "سینا_آرش", 236},
	{"seedbot_14", "farzad.ir", 262},
	{"seedbot_15", "الهام", 290},
	{"seedbot_16", "Behnam_T", 318},
	{"seedbot_17", "یاسمن جعفری", 348},
	{"seedbot_18", "amir_p", 380},
	{"seedbot_19", "کیوان", 414},
	{"seedbot_20", "Mina.H", 450},
	{"seedbot_21", "رضا_شاهین", 490},
	{"seedbot_22", "soroush77", 532},
	{"seedbot_23", "دنیا موسوی", 576},
	{"seedbot_24", "Parsa", 624},
	{"seedbot_25", "بابک", 676},
	{"seedbot_26", "tara_n", 730},
	{"seedbot_27", "حامد نظری", 788},
	{"seedbot_28", "Ario_K", 850},
	{"seedbot_29", "مریم", 914},
	{"seedbot_30", "Shayan.G", 982},
	{"seedbot_31", "آرمین_تهران", 1050},
	{"seedbot_32", "Roya", 1124},
	{"seedbot_33", "پدرام", 1200},
	{"seedbot_34", "ali_royal", 1290},
}

// seedBotLevels derives upgrade levels from trophies so a seed bot is as
// strong as a real player at the same rank would be: roughly one level per
// 80 trophies, with a deterministic wobble so no two defenses are identical.
func seedBotLevels(index, trophies int) (garrison, production, speed, treasury int) {
	base := trophies / 80
	wobble := (index*7)%3 - 1
	clamp := func(level int) int { return minInt(20, maxInt(0, level)) }
	return clamp(base + wobble), clamp(base - wobble), clamp(base), clamp(base - 1)
}

// seedBotCommander picks the commander a real player at that kingdom level
// could own, cycling through the unlocked ones.
func seedBotCommander(index, kingdomLevel int) string {
	unlocked := []string{"crown_guard"}
	for _, id := range []string{"quartermaster", "vanguard"} {
		if unlock, _ := CommanderUnlockLevel(id); kingdomLevel >= unlock {
			unlocked = append(unlocked, id)
		}
	}
	return unlocked[index%len(unlocked)]
}

// EnsureSeedBots inserts any missing seed bot and publishes its defense.
// Existing rows are left untouched, so a restart never reorders matchmaking
// and an operator can retune a bot by editing its row.
func (s *Store) EnsureSeedBots(ctx context.Context) (int, error) {
	tx, err := s.db.BeginTx(ctx, nil)
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	created := 0
	for index, bot := range seedBotRoster {
		garrison, production, speed, treasury := seedBotLevels(index, bot.Trophies)
		commander := seedBotCommander(index, garrison+production+speed+treasury)
		result, err := tx.ExecContext(ctx, `
			INSERT INTO players (id, coins, gems, trophies, starting_garrison_level, production_level,
			                     army_speed_level, treasury_level, selected_commander, tutorial_completed, is_bot)
			VALUES ($1, 0, 0, $2, $3, $4, $5, $6, $7, TRUE, TRUE)
			ON CONFLICT (id) DO NOTHING
		`, bot.ID, bot.Trophies, garrison, production, speed, treasury, commander)
		if err != nil {
			return 0, fmt.Errorf("seed bot %s: %w", bot.ID, err)
		}
		inserted, err := result.RowsAffected()
		if err != nil {
			return 0, err
		}
		if inserted == 0 {
			continue
		}
		if _, err := tx.ExecContext(ctx, `
			INSERT INTO player_names (player_id, display_name) VALUES ($1, $2)
			ON CONFLICT (player_id) DO NOTHING
		`, bot.ID, bot.Name); err != nil {
			return 0, err
		}
		career, err := getCareer(ctx, tx, bot.ID)
		if err != nil {
			return 0, err
		}
		if _, err := publishRealmDefense(ctx, tx, career); err != nil {
			return 0, err
		}
		created++
	}
	return created, tx.Commit()
}
