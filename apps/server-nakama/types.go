package main

type PlayerCareer struct {
	PlayerID              string `json:"playerId"`
	Coins                 int    `json:"coins"`
	Gems                  int    `json:"gems"`
	Trophies              int    `json:"trophies"`
	StartingGarrisonLevel int    `json:"startingGarrisonLevel"`
	ProductionLevel       int    `json:"productionLevel"`
	ArmySpeedLevel        int    `json:"armySpeedLevel"`
	TreasuryLevel         int    `json:"treasuryLevel"`
	MatchesPlayed         int    `json:"matchesPlayed"`
	MatchesWon            int    `json:"matchesWon"`
	CurrentStreak         int    `json:"currentStreak"`
	BestStreak            int    `json:"bestStreak"`
	LastMatchTimestamp    int64  `json:"lastMatchTimestamp"`
}

type RankTierInfo struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Badge       string `json:"badge"`
	MinTrophies int    `json:"minTrophies"`
	MaxTrophies int    `json:"maxTrophies"`
	Color       int    `json:"color"`
}

type MatchStats struct {
	MatchDurationSeconds        float64 `json:"matchDurationSeconds"`
	PlayerUnitsDispatched       float64 `json:"playerUnitsDispatched"`
	EnemyUnitsDispatched        float64 `json:"enemyUnitsDispatched"`
	TerritoriesCapturedByPlayer float64 `json:"territoriesCapturedByPlayer"`
	TerritoriesCapturedByEnemy  float64 `json:"territoriesCapturedByEnemy"`
}

type EconomyLedgerEntry struct {
	ID               string `json:"id"`
	Player           string `json:"player"`
	Currency         string `json:"currency"`
	Amount           int    `json:"amount"`
	Reason           string `json:"reason"`
	Source           string `json:"source"`
	PreviousBalance  int    `json:"previousBalance"`
	ResultingBalance int    `json:"resultingBalance"`
	Timestamp        int64  `json:"timestamp"`
}

type MatchRewardBreakdown struct {
	BaseCoins       int `json:"baseCoins"`
	SpeedBonus      int `json:"speedBonus"`
	DominationBonus int `json:"dominationBonus"`
	StreakBonus     int `json:"streakBonus"`
	TreasuryBonus   int `json:"treasuryBonus"`
	TotalCoins      int `json:"totalCoins"`
	TrophyDelta     int `json:"trophyDelta"`
}

type MatchSettlement struct {
	MatchID        string               `json:"matchId"`
	Status         string               `json:"status"`
	Breakdown      MatchRewardBreakdown `json:"breakdown"`
	Stats          MatchStats           `json:"stats"`
	PreviousCareer PlayerCareer         `json:"previousCareer"`
	NewCareer      PlayerCareer         `json:"newCareer"`
	PreviousRank   RankTierInfo         `json:"previousRank"`
	NewRank        RankTierInfo         `json:"newRank"`
	RankPromoted   bool                 `json:"rankPromoted"`
	LedgerEntries  []EconomyLedgerEntry `json:"ledgerEntries"`
}

type UpgradeType string

const (
	UpgradeStartingGarrison UpgradeType = "starting_garrison"
	UpgradeProduction       UpgradeType = "production"
	UpgradeArmySpeed        UpgradeType = "army_speed"
	UpgradeTreasury         UpgradeType = "treasury"
)

type UpgradePurchaseResult struct {
	Success        bool                `json:"success"`
	Reason         string              `json:"reason,omitempty"`
	Cost           *int                `json:"cost"`
	PreviousCareer PlayerCareer        `json:"previousCareer"`
	NewCareer      PlayerCareer        `json:"newCareer"`
	LedgerEntry    *EconomyLedgerEntry `json:"ledgerEntry,omitempty"`
}

type PlayerUpgradeModifiers struct {
	StartingUnits            int     `json:"startingUnits"`
	ProductionRateMultiplier float64 `json:"productionRateMultiplier"`
	ArmySpeedMultiplier      float64 `json:"armySpeedMultiplier"`
}

type PvpAction struct {
	Sequence  int     `json:"sequence"`
	AtSeconds float64 `json:"atSeconds"`
	SourceID  string  `json:"sourceId"`
	TargetID  string  `json:"targetId"`
}

type PvpDefenseSnapshot struct {
	PlayerID    string                 `json:"playerId"`
	DisplayName string                 `json:"displayName"`
	Trophies    int                    `json:"trophies"`
	MatchesWon  int                    `json:"matchesWon"`
	Modifiers   PlayerUpgradeModifiers `json:"modifiers"`
	PublishedAt int64                  `json:"publishedAt"`
}

type PvpOpponent struct {
	PlayerID           string                 `json:"playerId"`
	DisplayName        string                 `json:"displayName"`
	Trophies           int                    `json:"trophies"`
	MatchesWon         int                    `json:"matchesWon"`
	RankID             string                 `json:"rankId"`
	DefensePublishedAt int64                  `json:"defensePublishedAt"`
	IsRevenge          bool                   `json:"isRevenge"`
	Modifiers          PlayerUpgradeModifiers `json:"modifiers"`
}

type PvpAttackHistoryEntry struct {
	AttackID        string `json:"attackId"`
	AttackerID      string `json:"attackerId"`
	DefenderID      string `json:"defenderId"`
	Status          string `json:"status"`
	IsRevenge       bool   `json:"isRevenge"`
	DurationSeconds int    `json:"durationSeconds"`
	CreatedAt       int64  `json:"createdAt"`
	OpponentName    string `json:"opponentName"`
}

type PvpBattleSummary struct {
	Status           string     `json:"status"`
	Stats            MatchStats `json:"stats"`
	DurationSeconds  int        `json:"durationSeconds"`
	ActionsProcessed int        `json:"actionsProcessed"`
}

type AnalyticsEventRecord struct {
	EventID       string         `json:"eventId"`
	Name          string         `json:"name"`
	SessionID     string         `json:"sessionId"`
	OccurredAt    int64          `json:"occurredAt"`
	SchemaVersion int            `json:"schemaVersion"`
	Props         map[string]any `json:"props"`
}

type AnalyticsInsertResult struct {
	Inserted int
}

type DailyRewardType string

const (
	DailyPlayMatches        DailyRewardType = "play_matches"
	DailyWinMatch           DailyRewardType = "win_match"
	DailyCaptureTerritories DailyRewardType = "capture_territories"
	DailyCrownChest         DailyRewardType = "crown_chest"
)

type DailyMissionState struct {
	ID          DailyRewardType `json:"id"`
	Title       string          `json:"title"`
	Description string          `json:"description"`
	Progress    int             `json:"progress"`
	Target      int             `json:"target"`
	Reward      int             `json:"reward"`
	Complete    bool            `json:"complete"`
	Claimed     bool            `json:"claimed"`
}

type DailyChestState struct {
	Reward   int  `json:"reward"`
	Unlocked bool `json:"unlocked"`
	Claimed  bool `json:"claimed"`
}

type DailyState struct {
	DayKey   string              `json:"dayKey"`
	ResetsAt int64               `json:"resetsAt"`
	Missions []DailyMissionState `json:"missions"`
	Chest    DailyChestState     `json:"chest"`
}

type DailyClaimResult struct {
	ClaimID     string              `json:"claimId"`
	Success     bool                `json:"success"`
	Reason      string              `json:"reason,omitempty"`
	RewardType  DailyRewardType     `json:"rewardType"`
	Reward      int                 `json:"reward"`
	Replayed    bool                `json:"replayed"`
	State       DailyState          `json:"state"`
	NewCareer   PlayerCareer        `json:"newCareer"`
	LedgerEntry *EconomyLedgerEntry `json:"ledgerEntry,omitempty"`
}

type LeagueTierState struct {
	RankID      string `json:"rankId"`
	Name        string `json:"name"`
	Badge       string `json:"badge"`
	MinTrophies int    `json:"minTrophies"`
	Reward      int    `json:"reward"`
	Unlocked    bool   `json:"unlocked"`
	Claimed     bool   `json:"claimed"`
}

type LeagueState struct {
	Trophies      int               `json:"trophies"`
	KingdomPower  int               `json:"kingdomPower"`
	CurrentRankID string            `json:"currentRankId"`
	Tiers         []LeagueTierState `json:"tiers"`
}

type LeagueClaimResult struct {
	ClaimID     string              `json:"claimId"`
	Success     bool                `json:"success"`
	Reason      string              `json:"reason,omitempty"`
	RankID      string              `json:"rankId"`
	Reward      int                 `json:"reward"`
	Replayed    bool                `json:"replayed"`
	State       LeagueState         `json:"state"`
	NewCareer   PlayerCareer        `json:"newCareer"`
	LedgerEntry *EconomyLedgerEntry `json:"ledgerEntry,omitempty"`
}

type PvpAttackResult struct {
	AttackID   string           `json:"attackId"`
	AttackerID string           `json:"attackerId"`
	DefenderID string           `json:"defenderId"`
	IsRevenge  bool             `json:"isRevenge"`
	Summary    PvpBattleSummary `json:"summary"`
	Settlement MatchSettlement  `json:"settlement"`
}

type Team string
type TerritoryType string

const (
	TeamPlayer  Team = "player"
	TeamEnemy   Team = "enemy"
	TeamNeutral Team = "neutral"

	TerritoryFortress TerritoryType = "fortress"
	TerritoryBarracks TerritoryType = "barracks"
	TerritoryStable   TerritoryType = "stable"
)

type Territory struct {
	ID             string        `json:"id"`
	Name           string        `json:"name"`
	X              float64       `json:"x"`
	Y              float64       `json:"y"`
	Radius         float64       `json:"radius"`
	Owner          Team          `json:"owner"`
	Units          int           `json:"units"`
	MaxUnits       int           `json:"maxUnits"`
	ProductionRate float64       `json:"productionRate"`
	Tier           int           `json:"tier"`
	Type           TerritoryType `json:"type"`
}

type MarchingArmy struct {
	ID       string  `json:"id"`
	SourceID string  `json:"sourceId"`
	TargetID string  `json:"targetId"`
	Owner    Team    `json:"owner"`
	Units    int     `json:"units"`
	StartX   float64 `json:"startX"`
	StartY   float64 `json:"startY"`
	TargetX  float64 `json:"targetX"`
	TargetY  float64 `json:"targetY"`
	Progress float64 `json:"progress"`
	Speed    float64 `json:"speed"`
	Distance float64 `json:"distance"`
}

type GameState struct {
	Territories        map[string]Territory `json:"territories"`
	Armies             []MarchingArmy       `json:"armies"`
	Status             string               `json:"status"`
	ElapsedTimeSeconds float64              `json:"elapsedTimeSeconds"`
	TimeLimitSeconds   float64              `json:"timeLimitSeconds"`
	Stats              MatchStats           `json:"stats"`
}
