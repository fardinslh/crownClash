# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 139 files · ~123,685 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1536 nodes · 3897 edges · 71 communities (50 shown, 20 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `50015327`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pvp.ts
- testing.T
- CareerManager.ts
- domain.go
- GameScene
- PlatformAdapter
- upgrades.ts
- context.Context
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- TestGameObject
- types.go
- CareerManager
- DailyRewardType
- GameScene.ts
- UpgradeType
- HudLayout.ts
- NakamaClient.ts
- AnalyticsSink
- compilerOptions
- SoundEffects
- BalePlatformAdapter
- BrowserPlatformAdapter
- MatchMenuController
- CommanderScene
- platform/src/types.ts
- Analytics.ts
- DailyScene
- game-core/package.json
- platform/package.json
- LeagueScene
- EitaaPlatformAdapter
- TelegramPlatformAdapter
- generate_territories.py
- compilerOptions
- compilerOptions
- game/package.json
- generate_units.py
- PlayerCareer
- SmoothnessHelpers.ts
- MenuLayout.ts
- package.json
- HapticImpactStyle
- PerformanceMonitor
- daily.ts
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- LiveMatchClient.ts
- .ClaimDailyReward
- database/sql.DB
- env.d.ts
- UpgradeCardMeta.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- .renderResultModal
- live.go
- KingdomScene
- False-Green Guard
- LiveMatchClient
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md
- trackEvent
- .ClaimLeagueReward
- EconomyLedgerEntry
- RunMigrations

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 65 edges
2. `CareerManager` - 56 edges
3. `PlatformAdapter` - 56 edges
4. `BrowserPlatformAdapter` - 31 edges
5. `getSceneViewport()` - 30 edges
6. `NewStore()` - 30 edges
7. `BalePlatformAdapter` - 29 edges
8. `EitaaPlatformAdapter` - 29 edges
9. `TelegramPlatformAdapter` - 29 edges
10. `InitModule()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `PlayerCareer`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts
- `LiveReconciliationResult` --references--> `MarchingArmy`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (71 total, 20 thin omitted)

### Community 0 - "pvp.ts"
Cohesion: 0.05
Nodes (74): LiveMatchStarted, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction() (+66 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (72): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+64 more)

### Community 2 - "CareerManager.ts"
Cohesion: 0.17
Nodes (11): GameApiError, isLocalCareerFallbackAllowed(), localStorageMock, storage, { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, BotMatchTicket (+3 more)

### Community 3 - "domain.go"
Cohesion: 0.07
Nodes (71): TestBattlefieldLayoutsStaySymmetricAndDistinct(), TestBotBattlefieldReplayIsDeterministic(), applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories() (+63 more)

### Community 5 - "PlatformAdapter"
Cohesion: 0.07
Nodes (15): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+7 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.10
Nodes (41): KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomTier, KingdomTierId, MAX_KINGDOM_LEVEL, claimLeagueRewardLocally(), createLeagueState(), getKingdomPower() (+33 more)

### Community 7 - "context.Context"
Cohesion: 0.11
Nodes (28): CommanderUnlockLevel(), careerFromRow(), findStoredSettlement(), findStoredUpgradePurchase(), getCareer(), getCareerForUpdate(), MatchSettlement, MatchStats (+20 more)

### Community 8 - "TutorialController"
Cohesion: 0.10
Nodes (14): createController(), createRecorder(), get(), mockLocalStorage(), isTutorialCompleted(), markTutorialCompleted(), STEP_DEFINITIONS, storageKey() (+6 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "TestGameObject"
Cohesion: 0.08
Nodes (3): { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, TestContainer, TestGameObject

### Community 11 - "types.go"
Cohesion: 0.13
Nodes (30): BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState, EconomyLedgerEntry (+22 more)

### Community 13 - "DailyRewardType"
Cohesion: 0.20
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "GameScene.ts"
Cohesion: 0.18
Nodes (23): trackUpgradeEvent(), sounds, MISSION_ICONS, ArmyFollower, ArmyVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+15 more)

### Community 15 - "UpgradeType"
Cohesion: 0.15
Nodes (8): ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, purchaseUpgradeThroughCareer(), UpgradeCareerSource, isUpgradeMilestoneLevel(), UpgradePurchaseResult, UpgradeType

### Community 16 - "HudLayout.ts"
Cohesion: 0.16
Nodes (20): DominanceBarLayout, DominanceCalculationInput, estimateTextWidthFallback(), fitTextToWidth(), formatCompactNumber(), formatHudCoins(), formatHudName(), formatHudTrophies() (+12 more)

### Community 17 - "NakamaClient.ts"
Cohesion: 0.14
Nodes (8): StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), NakamaClient, normalizeNakamaError(), CommanderId, CommanderSelectionResult, LeagueClaimResult

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (8): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 24 - "CommanderScene"
Cohesion: 0.19
Nodes (9): CommanderScene, computeCommanderLayout(), CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId() (+1 more)

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.11
Nodes (17): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+9 more)

### Community 28 - "game-core/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 29 - "platform/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 33 - "generate_territories.py"
Cohesion: 0.26
Nodes (14): assign_material(), build_citadel(), build_crown_keep(), build_outpost(), clear_mesh_objects(), get_or_create_material(), main(), Crown Clash - 2.5D Territory Asset Generator Generates and renders stylized… (+6 more)

### Community 34 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir (+4 more)

### Community 35 - "compilerOptions"
Cohesion: 0.15
Nodes (12): compilerOptions, declaration, esModuleInterop, forceConsistentCasingInFileNames, lib, module, moduleResolution, outDir (+4 more)

### Community 36 - "game/package.json"
Cohesion: 0.07
Nodes (36): dependencies, @crown-clash/game-core, @crown-clash/platform, @heroiclabs/nakama-js, phaser, devDependencies, @types/node, typescript (+28 more)

### Community 37 - "generate_units.py"
Cohesion: 0.31
Nodes (10): assign_material(), build_toy_knight(), clear_mesh_objects(), get_or_create_material(), main(), Crown Clash - 2.5D Army Unit Token Generator Generates and renders stylized…, Builds a stylized 2.5D toy knight warrior figurine: - Round beveled plinth -…, render_sprite() (+2 more)

### Community 38 - "PlayerCareer"
Cohesion: 0.17
Nodes (3): CareerApi, isStaleSocketError(), PlayerCareer

### Community 39 - "SmoothnessHelpers.ts"
Cohesion: 0.15
Nodes (11): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+3 more)

### Community 40 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 43 - "PerformanceMonitor"
Cohesion: 0.07
Nodes (11): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, FrameStats, LifecycleStats, MemoryStats, NetworkStats (+3 more)

### Community 44 - "daily.ts"
Cohesion: 0.26
Nodes (11): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+3 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.18
Nodes (31): afterAuthenticateCustom(), analyticsProperties(), analyticsPropertiesWithDuration(), PvpAction, Store, InitModule(), loadServerConfig(), parseActionPayload() (+23 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

### Community 48 - "LiveMatchClient.ts"
Cohesion: 0.27
Nodes (9): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, LiveServerPayload, MatchSettlement, PvpBattleSummary (+1 more)

### Community 49 - ".ClaimDailyReward"
Cohesion: 0.15
Nodes (24): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+16 more)

### Community 50 - "database/sql.DB"
Cohesion: 0.19
Nodes (17): Store, newLiveJoinCode(), newLiveMatchHandler(), beforeAuthenticateCustom(), matchmakerMatched(), rpcCreateInvite(), rpcJoinInvite(), database/sql.DB (+9 more)

### Community 52 - "UpgradeCardMeta.ts"
Cohesion: 0.50
Nodes (3): UPGRADE_CARD_META, UPGRADE_TYPES, UpgradeCardMeta

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 58 - "live.go"
Cohesion: 0.17
Nodes (19): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Team, liveArmyID(), livePlayerMatchID(), mapTeamForRole() (+11 more)

### Community 59 - "KingdomScene"
Cohesion: 0.22
Nodes (3): KingdomScene, getKingdomProgress(), KingdomProgress

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 64 - "Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist"
Cohesion: 0.13
Nodes (14): 1. Device Matrix, 2. Preparation & Launch, 3. Real-Device QA Test Protocol, 4. Adverse Network Verification, 5. Performance Acceptance Thresholds, 6. QA Session Report Template, A. Local Network & Dev Server, B. Launch Modes & Query Parameters (+6 more)

### Community 67 - "trackEvent"
Cohesion: 0.27
Nodes (4): trackEvent(), Lesson, TrainingScene, TutorialStepId

### Community 68 - ".ClaimLeagueReward"
Cohesion: 0.27
Nodes (8): findStoredLeagueClaim(), getClaimedLeagueRanks(), getRankTierForID(), LeagueState, RankTierInfo, Store, LeagueClaimResult, leagueRowsQuerier

## Knowledge Gaps
- **271 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+266 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 440 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `CareerManager.ts`, `trackEvent`, `GameScene`, `PlayerCareer`, `KingdomScene`, `CareerManager`, `GameScene.ts`, `NakamaClient.ts`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `CommanderScene`, `platform/src/types.ts`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `pvp.ts`, `CareerManager.ts`, `PlatformAdapter`, `CareerManager`, `GameScene.ts`, `HudLayout.ts`, `MatchMenuController`, `.renderResultModal`, `Analytics.ts`, `LiveMatchClient`?**
  _High betweenness centrality (0.044) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `CareerManager.ts`, `GameScene`, `PlatformAdapter`, `EconomyLedgerEntry`, `PlayerCareer`, `KingdomScene`, `daily.ts`, `GameScene.ts`, `CommanderScene`, `.renderResultModal`, `DailyScene`, `LeagueScene`?**
  _High betweenness centrality (0.041) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _271 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pvp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05236091631603553 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.06080246913580247 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07404664938911515 - nodes in this community are weakly interconnected._