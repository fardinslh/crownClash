# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 146 files · ~128,323 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1588 nodes · 4036 edges · 70 communities (46 shown, 23 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3b4f3c07`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- dispatch.ts
- testing.T
- PlayerCareer
- domain.go
- GameScene
- .openLivePvpLobby
- upgrades.ts
- context.Context
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- TestGameObject
- types.go
- CareerManager
- LiveMatchClient.ts
- GameScene.ts
- MarchingArmy
- HudLayout.ts
- NakamaClient
- AnalyticsSink
- compilerOptions
- SoundEffects
- BalePlatformAdapter
- BrowserPlatformAdapter
- MatchMenuController
- simulation.ts
- platform/src/types.ts
- Analytics.ts
- DailyRewardType
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
- daily.ts
- LiveCombatFeedback.ts
- DailyScene
- package.json
- HapticImpactStyle
- PerformanceMonitor
- LiveMatchClient
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- pvp.ts
- game-core/src/types.ts
- TrainingScene
- env.d.ts
- TutorialController.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- CareerManager.ts
- .create
- PlatformAdapter
- False-Green Guard
- LOGICAL_HEIGHT
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md
- CommanderScene
- .renderResultModal
- .finalizeMatch

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 69 edges
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
- `deriveLiveCombatArrivals()` --calls--> `resolveArrival()`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/combat.ts

## Import Cycles
- None detected.

## Communities (70 total, 23 thin omitted)

### Community 0 - "dispatch.ts"
Cohesion: 0.33
Nodes (8): AiMove, evaluateAiMove(), BASE_ARMY_TRAVEL_SPEED, calculateDispatchUnits(), dispatchArmy(), dispatchMultipleArmies(), consumeSimulationTicks(), getTerritoryArmySpeedMultiplier()

### Community 1 - "testing.T"
Cohesion: 0.07
Nodes (67): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+59 more)

### Community 2 - "PlayerCareer"
Cohesion: 0.15
Nodes (11): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked() (+3 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (68): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CommanderUnlockLevel(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState() (+60 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.10
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.05
Nodes (51): KingdomScene, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, purchaseUpgradeThroughCareer(), UpgradeCareerSource, getKingdomProgress(), KINGDOM_TIERS (+43 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (57): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+49 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "TestGameObject"
Cohesion: 0.08
Nodes (3): { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, TestContainer, TestGameObject

### Community 11 - "types.go"
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 13 - "LiveMatchClient.ts"
Cohesion: 0.19
Nodes (15): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, canHandleLiveSettlement(), LiveMatchResultConsumerContext, LiveSettlementGateOptions (+7 more)

### Community 14 - "GameScene.ts"
Cohesion: 0.19
Nodes (23): trackUpgradeEvent(), sounds, platform, MISSION_ICONS, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, LESSONS (+15 more)

### Community 15 - "MarchingArmy"
Cohesion: 0.16
Nodes (9): ArmyFollower, ArmyVisualPool, MAX_FOLLOWERS_PER_ARMY, LiveReconciliationResult, DispatchResult, MultiDispatchResult, TERRITORY_TYPE_PRESENTATION, MarchingArmy (+1 more)

### Community 16 - "HudLayout.ts"
Cohesion: 0.08
Nodes (32): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+24 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.08
Nodes (13): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+5 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 24 - "simulation.ts"
Cohesion: 0.22
Nodes (14): BattlefieldDefinition, BattlefieldId, createLocalBotMatchTicket(), DEFAULT_BATTLEFIELD_ID, getBattlefield(), normalizeBattlefieldId(), createDefaultTerritories(), PvpDefenseSnapshot (+6 more)

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.12
Nodes (16): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+8 more)

### Community 27 - "DailyRewardType"
Cohesion: 0.21
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

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

### Community 38 - "daily.ts"
Cohesion: 0.16
Nodes (13): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+5 more)

### Community 39 - "LiveCombatFeedback.ts"
Cohesion: 0.19
Nodes (12): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction() (+4 more)

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (23): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+15 more)

### Community 44 - "LiveMatchClient"
Cohesion: 0.17
Nodes (3): trackTerminalMatchEvent(), LiveMatchClient, parseLiveErrorCode()

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.06
Nodes (79): ExtractUnverifiedUser(), extractUser(), stringifyUserID(), VerifyTelegramStyleInitData(), canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer (+71 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

### Community 48 - "pvp.ts"
Cohesion: 0.18
Nodes (15): BATTLEFIELDS, dispatchFromState(), MAX_PVP_ACTIONS, PVP_AI_TICK_SECONDS, PVP_SIMULATION_TICK_SECONDS, PVP_TIME_LIMIT_SECONDS, PvpAttackHistoryEntry, PvpAttackResult (+7 more)

### Community 49 - "game-core/src/types.ts"
Cohesion: 0.17
Nodes (17): StressDispatchPair, TerritoryVisual, resolveArrival(), GenerationUpdateResult, tickUnitGeneration(), BARRACKS_PRODUCTION_MULTIPLIER, FORTRESS_DEFENSE_MULTIPLIER, getRemainingDefenders() (+9 more)

### Community 52 - "TutorialController.ts"
Cohesion: 0.18
Nodes (15): Lesson, createController(), createRecorder(), get(), mockLocalStorage(), isTutorialCompleted(), markTutorialCompleted(), STEP_DEFINITIONS (+7 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "CareerManager.ts"
Cohesion: 0.14
Nodes (16): CareerApi, GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), getSharedGameApiClient(), isStaleSocketError() (+8 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 61 - "LOGICAL_HEIGHT"
Cohesion: 0.22
Nodes (6): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS, ExpandSimulationResult, LOGICAL_HEIGHT

### Community 64 - "Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist"
Cohesion: 0.13
Nodes (14): 1. Device Matrix, 2. Preparation & Launch, 3. Real-Device QA Test Protocol, 4. Adverse Network Verification, 5. Performance Acceptance Thresholds, 6. QA Session Report Template, A. Local Network & Dev Server, B. Launch Modes & Query Parameters (+6 more)

### Community 67 - "CommanderScene"
Cohesion: 0.42
Nodes (3): CommanderScene, computeCommanderLayout(), getKingdomLevel()

## Knowledge Gaps
- **280 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+275 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 459 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `PlayerCareer`, `CommanderScene`, `GameScene`, `.openLivePvpLobby`, `upgrades.ts`, `DailyScene`, `CareerManager`, `GameScene.ts`, `TrainingScene`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `CareerManager.ts`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.081) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `.renderResultModal`, `.finalizeMatch`, `LiveCombatFeedback.ts`, `LiveMatchClient`, `CareerManager`, `GameScene.ts`, `MarchingArmy`, `HudLayout.ts`, `AnalyticsSink`, `MatchMenuController`, `simulation.ts`, `CareerManager.ts`, `.create`, `PlatformAdapter`?**
  _High betweenness centrality (0.058) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `PlayerCareer`, `CommanderScene`, `GameScene`, `.openLivePvpLobby`, `daily.ts`, `.renderResultModal`, `DailyScene`, `upgrades.ts`, `GameScene.ts`, `TrainingScene`, `CareerManager.ts`, `LeagueScene`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _280 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.06702702702702702 - nodes in this community are weakly interconnected._
- **Should `PlayerCareer` be split into smaller, more focused modules?**
  _Cohesion score 0.14619883040935672 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07766599597585513 - nodes in this community are weakly interconnected._