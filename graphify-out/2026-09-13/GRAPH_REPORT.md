# Graph Report - crownClash  (2026-09-13)

## Corpus Check
- 158 files · ~292,582 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1619 nodes · 4080 edges · 67 communities (47 shown, 19 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `95e39391`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- BenchmarkTypes.ts
- testing.T
- commanders.ts
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
- gameSceneGuards.ts
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
- pvp.ts
- platform/src/types.ts
- Analytics.ts
- .create
- game-core/package.json
- platform/package.json
- PlayerCareer
- EitaaPlatformAdapter
- TelegramPlatformAdapter
- generate_territories.py
- compilerOptions
- compilerOptions
- game/package.json
- generate_units.py
- DailyScene
- daily.ts
- DailyRewardType
- package.json
- HapticImpactStyle
- PerformanceMonitor
- CareerManager.ts
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- TutorialController.ts
- trackEvent
- LiveMatchClient
- env.d.ts
- LiveCombatFeedback.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- CommanderScene
- LiveMatchClient.ts
- LOGICAL_HEIGHT
- False-Green Guard
- LeagueState
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 67 edges
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
- `LiveMatchResult` --references--> `MatchSettlement`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/progression.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `PlayerCareer`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (67 total, 19 thin omitted)

### Community 0 - "BenchmarkTypes.ts"
Cohesion: 0.07
Nodes (42): calculateMetricDelta(), compareBenchmarks(), CompareOptions, calculatePercentiles(), computeBenchmarkMetrics(), processAndDeduplicateFrames(), RawArmySample, RawBenchmarkSampleInput (+34 more)

### Community 1 - "testing.T"
Cohesion: 0.07
Nodes (66): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+58 more)

### Community 2 - "commanders.ts"
Cohesion: 0.19
Nodes (10): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked() (+2 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (67): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield() (+59 more)

### Community 5 - "PlatformAdapter"
Cohesion: 0.07
Nodes (15): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+7 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.10
Nodes (40): KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomTier, KingdomTierId, MAX_KINGDOM_LEVEL, claimLeagueRewardLocally(), createLeagueState(), getKingdomPower() (+32 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (60): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+52 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "TestGameObject"
Cohesion: 0.08
Nodes (3): { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, TestContainer, TestGameObject

### Community 11 - "types.go"
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 12 - "CareerManager"
Cohesion: 0.22
Nodes (4): isLocalCareerFallbackAllowed(), CareerManager, isStaleSocketError(), MatchSettlement

### Community 13 - "gameSceneGuards.ts"
Cohesion: 0.16
Nodes (13): trackTerminalMatchEvent(), LiveMatchResult, canFinalizeBotSettlement(), canHandleLiveSettlement(), canInitiateBotSettlement(), LiveMatchResultConsumerContext, LiveSettlementGateOptions, processLiveMatchResult() (+5 more)

### Community 14 - "GameScene.ts"
Cohesion: 0.19
Nodes (23): trackUpgradeEvent(), sounds, MISSION_ICONS, ArmyFollower, ArmyVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+15 more)

### Community 15 - "UpgradeType"
Cohesion: 0.07
Nodes (12): KingdomScene, LeagueScene, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, purchaseUpgradeThroughCareer(), UpgradeCareerSource, getKingdomProgress() (+4 more)

### Community 16 - "HudLayout.ts"
Cohesion: 0.08
Nodes (32): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+24 more)

### Community 17 - "NakamaClient.ts"
Cohesion: 0.15
Nodes (6): StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), NakamaClient, normalizeNakamaError(), LeagueClaimResult

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (8): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 24 - "pvp.ts"
Cohesion: 0.06
Nodes (62): LiveReconciliationResult, StressDispatchPair, TerritoryVisual, AiMove, evaluateAiMove(), BattlefieldDefinition, BattlefieldId, BATTLEFIELDS (+54 more)

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.11
Nodes (16): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+8 more)

### Community 28 - "game-core/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 29 - "platform/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 30 - "PlayerCareer"
Cohesion: 0.14
Nodes (4): CareerApi, CommanderSelectionResult, EconomyLedgerEntry, PlayerCareer

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

### Community 39 - "daily.ts"
Cohesion: 0.23
Nodes (11): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+3 more)

### Community 40 - "DailyRewardType"
Cohesion: 0.22
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (23): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+15 more)

### Community 44 - "CareerManager.ts"
Cohesion: 0.20
Nodes (10): trackSessionStart(), GameApiError, getSharedGameApiClient(), localStorageMock, storage, platform, startApp(), BotMatchTicket (+2 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.06
Nodes (78): ExtractUnverifiedUser(), extractUser(), stringifyUserID(), VerifyTelegramStyleInitData(), canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer (+70 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

### Community 48 - "TutorialController.ts"
Cohesion: 0.21
Nodes (13): createController(), createRecorder(), get(), mockLocalStorage(), isTutorialCompleted(), markTutorialCompleted(), STEP_DEFINITIONS, storageKey() (+5 more)

### Community 52 - "LiveCombatFeedback.ts"
Cohesion: 0.32
Nodes (7): applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction(), stepLiveArmies()

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "CommanderScene"
Cohesion: 0.42
Nodes (3): CommanderScene, computeCommanderLayout(), getKingdomLevel()

### Community 58 - "LiveMatchClient.ts"
Cohesion: 0.24
Nodes (9): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchStarted, LiveServerPayload, parseLiveErrorCode(), PvpSimulationResult (+1 more)

### Community 59 - "LOGICAL_HEIGHT"
Cohesion: 0.22
Nodes (6): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS, ExpandSimulationResult, LOGICAL_HEIGHT

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 64 - "Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist"
Cohesion: 0.13
Nodes (14): 1. Device Matrix, 2. Preparation & Launch, 3. Real-Device QA Test Protocol, 4. Adverse Network Verification, 5. Performance Acceptance Thresholds, 6. QA Session Report Template, A. Local Network & Dev Server, B. Launch Modes & Query Parameters (+6 more)

## Knowledge Gaps
- **297 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+292 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 471 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `commanders.ts`, `GameScene`, `DailyScene`, `CareerManager.ts`, `CareerManager`, `GameScene.ts`, `UpgradeType`, `NakamaClient.ts`, `trackEvent`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `CommanderScene`, `PlayerCareer`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.068) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `GameScene`, `PlatformAdapter`, `DailyScene`, `daily.ts`, `CareerManager.ts`, `GameScene.ts`, `UpgradeType`, `CommanderScene`, `.create`, `LeagueState`, `PlayerCareer`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `PlatformAdapter`, `CareerManager.ts`, `CareerManager`, `GameScene.ts`, `gameSceneGuards.ts`, `HudLayout.ts`, `LiveMatchClient`, `LiveCombatFeedback.ts`, `MatchMenuController`, `pvp.ts`, `LiveMatchClient.ts`, `.create`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _297 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `BenchmarkTypes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06531204644412192 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.06812291743798593 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07950310559006211 - nodes in this community are weakly interconnected._