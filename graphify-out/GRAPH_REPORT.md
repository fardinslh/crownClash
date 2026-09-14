# Graph Report - crownClash  (2026-09-14)

## Corpus Check
- 196 files · ~296,926 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1765 nodes · 4308 edges · 89 communities (70 shown, 18 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 166 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `981b64c9`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- BenchmarkAggregator.ts
- testing.T
- CareerManager.ts
- UpgradeModifiers
- mobile-stutter-diagnostics.md
- .openLivePvpLobby
- upgrades.ts
- context.Context
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- TestGameObject
- types.go
- CareerManager
- Analytics.ts
- GameScene.ts
- KingdomScene
- HudLayout.ts
- TrainingScene.ts
- AnalyticsSink
- compilerOptions
- SoundEffects
- DefaultModifiers
- LiveMatchClient.ts
- MatchMenuController
- NakamaClient
- platform/src/types.ts
- KingdomScene.ts
- GameScene
- game-core/package.json
- platform/package.json
- PlatformAdapter
- domain.go
- BalePlatformAdapter
- generate_territories.py
- compilerOptions
- compilerOptions
- game/package.json
- generate_units.py
- DailyScene
- TelegramPlatformAdapter
- SmoothnessHelpers.ts
- package.json
- game-core/src/types.ts
- PerformanceMonitor
- battlefields.ts
- Crown Clash — Art Bible & Visual Direction
- daily.ts
- LiveMatchClient
- BenchmarkComparator.ts
- BrowserPlatformAdapter
- run-benchmark.mjs
- env.d.ts
- LeagueScene
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- Exact Failure Reason Outputs
- EitaaPlatformAdapter
- TowerRoleIcon.ts
- False-Green Guard
- parseAnalyticsEventsPayload
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md
- Benchmark Multi-Run Aggregation Report: normal_combat
- BenchmarkTypes.ts
- BenchmarkMetricsCalculator.ts
- DeterministicScenarioDriver.ts
- False-Green Diagnostic Verification Report
- Territory
- LiveCombatFeedback.ts
- pvp.ts
- getSceneViewport
- main.go
- HapticImpactStyle
- DailyRewardType
- HubLayouts.ts
- .renderResultModal
- daily_test.go
- RenderProfile.ts
- MenuLayout.ts
- BattlefieldArenaLayout.ts
- frontend-docker-packaging.test.mjs
- auth_identity_test.go
- capture-visual-check.mjs
- Army Visuals Rendering Optimization Report

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 70 edges
2. `PlatformAdapter` - 57 edges
3. `CareerManager` - 56 edges
4. `BrowserPlatformAdapter` - 32 edges
5. `getSceneViewport()` - 30 edges
6. `NewStore()` - 30 edges
7. `BalePlatformAdapter` - 29 edges
8. `EitaaPlatformAdapter` - 29 edges
9. `TelegramPlatformAdapter` - 29 edges
10. `InitModule()` - 28 edges

## Surprising Connections (you probably didn't know these)
- `RenderEnvironment` --references--> `PlatformType`  [EXTRACTED]
  apps/game/src/render/RenderProfile.ts → packages/platform/src/types.ts
- `LiveMatchResult` --references--> `MatchSettlement`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/progression.ts
- `LiveMatchResult` --references--> `MatchStats`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts

## Import Cycles
- None detected.

## Communities (89 total, 18 thin omitted)

### Community 0 - "BenchmarkAggregator.ts"
Cohesion: 0.22
Nodes (11): aggregateBenchmarkRuns(), calculateSampleStats(), DEFAULT_AGGREGATE_THRESHOLDS, formatAggregateMarkdown(), BenchmarkAggregateReport, BenchmarkReport, __dirname, __filename (+3 more)

### Community 1 - "testing.T"
Cohesion: 0.10
Nodes (39): analyticsPropsJSON(), TestInsertAnalyticsEventsCommitsWholeBatch(), TestInsertAnalyticsEventsIsIdempotentByPlayerAndEventID(), TestInsertAnalyticsEventsNormalizesDailyRewardFromClaim(), TestInsertAnalyticsEventsNormalizesLeagueRewardFromClaim(), TestInsertAnalyticsEventsNormalizesMatchEndFromSettlement(), TestInsertAnalyticsEventsNormalizesRankPromotionFromSettlement(), TestInsertAnalyticsEventsNormalizesRewardFromSettlement() (+31 more)

### Community 2 - "CareerManager.ts"
Cohesion: 0.12
Nodes (16): CareerApi, GameApiError, TrackedAnalyticsEvent, getSharedGameApiClient(), isStaleSocketError(), localStorageMock, storage, BotMatchTicket (+8 more)

### Community 3 - "UpgradeModifiers"
Cohesion: 0.13
Nodes (28): BuildLeagueState(), CalculateMatchRewards(), CreateDefaultCareer(), GetRankTier(), LeagueState, MatchSettlement, MatchStats, PlayerCareer (+20 more)

### Community 4 - "mobile-stutter-diagnostics.md"
Cohesion: 0.12
Nodes (15): 1. Measured Scenario Benchmark Results, 2. Subsystem Attribution Breakdown (Measured CPU Timings), 3. Trace Window Validation & Subsystem Breakdown, 4. Measured Facts versus Inferred Explanations, 5. Projections for 2v2 and Larger Maps (Architectural Modeling), 6. Corrected Bottleneck Ranking, 7. Evidence-Supported First Optimization Recommendation, 8. Instrumentation Limitations & Transparency (+7 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.11
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.09
Nodes (45): LiveMatchResultConsumerContext, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId(), KINGDOM_TIERS, KINGDOM_UPGRADES (+37 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (59): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+51 more)

### Community 8 - "TutorialController"
Cohesion: 0.12
Nodes (7): createController(), createRecorder(), get(), mockLocalStorage(), TUTORIAL_STEPS, TutorialController, TutorialEvent

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (24): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+16 more)

### Community 10 - "TestGameObject"
Cohesion: 0.08
Nodes (3): { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, TestContainer, TestGameObject

### Community 11 - "types.go"
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 12 - "CareerManager"
Cohesion: 0.17
Nodes (5): isLocalCareerFallbackAllowed(), CareerManager, PlayerCareer, DailyState, UpgradePurchaseBase

### Community 13 - "Analytics.ts"
Cohesion: 0.10
Nodes (20): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+12 more)

### Community 14 - "GameScene.ts"
Cohesion: 0.15
Nodes (20): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2, MockImage, MockRectangle, MockEllipse, MockCircle, MockText }, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+12 more)

### Community 15 - "KingdomScene"
Cohesion: 0.15
Nodes (7): KingdomScene, computeKingdomLayout(), bindSceneViewportResize(), setupSceneCamera(), getKingdomProgress(), KingdomProgress, createPlatformAdapter()

### Community 16 - "HudLayout.ts"
Cohesion: 0.16
Nodes (20): DominanceBarLayout, DominanceCalculationInput, estimateTextWidthFallback(), fitTextToWidth(), formatCompactNumber(), formatHudCoins(), formatHudName(), formatHudTrophies() (+12 more)

### Community 17 - "TrainingScene.ts"
Cohesion: 0.16
Nodes (11): Lesson, LESSONS, TrainingScene, isTutorialCompleted(), markTutorialCompleted(), STEP_DEFINITIONS, storageKey(), TutorialEventCallback (+3 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 21 - "DefaultModifiers"
Cohesion: 0.22
Nodes (23): CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield(), DefaultModifiers(), evaluateAIMove(), GameState, PvpAction, simulateBattle() (+15 more)

### Community 22 - "LiveMatchClient.ts"
Cohesion: 0.16
Nodes (17): trackTerminalMatchEvent(), LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, LiveMatchStarted, LiveServerPayload (+9 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 24 - "NakamaClient"
Cohesion: 0.16
Nodes (4): StaleSocketError, isNakamaTransportError(), NakamaClient, normalizeNakamaError()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "KingdomScene.ts"
Cohesion: 0.16
Nodes (8): CardHandle, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, UPGRADE_CARD_META, UPGRADE_TYPES, UpgradeCardMeta, UpgradeType

### Community 28 - "game-core/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 29 - "platform/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 31 - "domain.go"
Cohesion: 0.18
Nodes (18): calculateDispatchUnits(), CommanderUnlockLevel(), dispatchArmy(), Team, IsBattlefieldID(), isFinitePositive(), remainingDefenders(), resolveArrival() (+10 more)

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

### Community 40 - "SmoothnessHelpers.ts"
Cohesion: 0.15
Nodes (11): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+3 more)

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "game-core/src/types.ts"
Cohesion: 0.19
Nodes (15): resolveArrival(), tickUnitGeneration(), DEFAULT_MATCH_TIME_LIMIT, StepResult, BARRACKS_PRODUCTION_MULTIPLIER, FORTRESS_DEFENSE_MULTIPLIER, getRemainingDefenders(), getTerritoryDefenseMultiplier() (+7 more)

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (23): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+15 more)

### Community 44 - "battlefields.ts"
Cohesion: 0.19
Nodes (15): StressDispatchPair, TerritoryVisual, BattlefieldDefinition, BATTLEFIELDS, BattlefieldTerritoryTemplate, BattlefieldVisualTheme, DEFAULT_BATTLEFIELD_ID, getBattlefield() (+7 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "daily.ts"
Cohesion: 0.18
Nodes (15): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset() (+7 more)

### Community 48 - "BenchmarkComparator.ts"
Cohesion: 0.15
Nodes (12): calculateMetricDelta(), compareBenchmarks(), CompareOptions, BenchmarkComparisonResult, MetricDelta, __dirname, __filename, REPO_ROOT (+4 more)

### Community 50 - "run-benchmark.mjs"
Cohesion: 0.21
Nodes (10): CdpClient, __dirname, DIST_DIR, __filename, MIME_TYPES, REPO_ROOT, runDeterministicBenchmark(), sleep() (+2 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "Exact Failure Reason Outputs"
Cohesion: 0.14
Nodes (13): Exact Failure Reason Outputs, False-Green Guard Verification Report, NC-1: Software WebGL, NC-2: Army Count > 10, NC-3: Seed Mismatch, NC-4: CPU Throttle Mismatch, NC-5: Network Profile Mismatch, NC-6: Scenario Name Mismatch (+5 more)

### Community 59 - "TowerRoleIcon.ts"
Cohesion: 0.22
Nodes (12): ACCESSIBLE_NAME_MAP, computeTowerRoleIconGeometry(), drawTowerRoleIcon(), getTowerRoleAccessibleName(), getTowerRoleIconKind(), IconPoint, IconShape, ROLE_KIND_MAP (+4 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 61 - "parseAnalyticsEventsPayload"
Cohesion: 0.34
Nodes (14): analyticsPayload(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps(), TestAnalyticsPayloadAcceptsValidEvent() (+6 more)

### Community 64 - "Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist"
Cohesion: 0.13
Nodes (14): 1. Device Matrix, 2. Preparation & Launch, 3. Real-Device QA Test Protocol, 4. Adverse Network Verification, 5. Performance Acceptance Thresholds, 6. QA Session Report Template, A. Local Network & Dev Server, B. Launch Modes & Query Parameters (+6 more)

### Community 68 - "BenchmarkTypes.ts"
Cohesion: 0.17
Nodes (11): BenchmarkAggregateThresholds, BenchmarkBuildMode, BenchmarkComparisonSuccess, BenchmarkEnvironment, BenchmarkRendererType, ComparisonRejection, ComparisonRejectionReasonCode, LifecycleTransition (+3 more)

### Community 69 - "BenchmarkMetricsCalculator.ts"
Cohesion: 0.21
Nodes (14): calculatePercentiles(), computeBenchmarkMetrics(), processAndDeduplicateFrames(), RawArmySample, RawBenchmarkSampleInput, RawFrameSample, verifyPrerequisites(), BenchmarkMetrics (+6 more)

### Community 70 - "DeterministicScenarioDriver.ts"
Cohesion: 0.33
Nodes (7): BenchmarkScenarioConfig, BenchmarkScenarioName, computeScheduleHash(), createMulberry32(), DeterministicScenarioDefinition, SCENARIO_DEFINITIONS, ScriptedDispatch

### Community 71 - "False-Green Diagnostic Verification Report"
Cohesion: 0.40
Nodes (4): 1. Negative Control (Injected 75ms Long Task), 2. Restored Clean Control (No Injection), False-Green Diagnostic Verification Report, Objective

### Community 72 - "Territory"
Cohesion: 0.27
Nodes (11): AiMove, evaluateAiMove(), BASE_ARMY_TRAVEL_SPEED, calculateDispatchUnits(), dispatchArmy(), dispatchMultipleArmies(), DispatchResult, MultiDispatchResult (+3 more)

### Community 73 - "LiveCombatFeedback.ts"
Cohesion: 0.27
Nodes (9): applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction(), stepLiveArmies() (+1 more)

### Community 74 - "pvp.ts"
Cohesion: 0.12
Nodes (23): BattlefieldId, consumeSimulationTicks(), dispatchFromState(), MAX_PVP_ACTIONS, PVP_AI_TICK_SECONDS, PVP_SIMULATION_TICK_SECONDS, PVP_TIME_LIMIT_SECONDS, PvpAttackHistoryEntry (+15 more)

### Community 75 - "getSceneViewport"
Cohesion: 0.35
Nodes (5): CommanderScene, computeCommanderLayout(), getSceneViewport(), CommanderDefinition, getKingdomLevel()

### Community 76 - "main.go"
Cohesion: 0.06
Nodes (79): ExtractUnverifiedUser(), extractUser(), stringifyUserID(), VerifyTelegramStyleInitData(), canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer (+71 more)

### Community 77 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 78 - "DailyRewardType"
Cohesion: 0.30
Nodes (4): DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 79 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (9): CommanderLayout, computeDailyLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout, LeagueLayout (+1 more)

### Community 80 - ".renderResultModal"
Cohesion: 0.24
Nodes (3): wholeMatchSeconds(), computeResultRankPresentation(), ResultRankPresentation

### Community 81 - "daily_test.go"
Cohesion: 0.31
Nodes (8): dailyCareerRows(), dailyProgressRows(), sqlmock.Rows, TestDailyClaimAwardsCoinsAndWritesAuditLedger(), TestDailyClaimRejectsAnotherPlayersClaimID(), TestDailyClaimReplayReturnsStoredResultWithoutMutation(), TestDailyMigrationAddsProgressAndIdempotentClaims(), TestStoredSettlementReplayDoesNotAdvanceDailyProgress()

### Community 82 - "RenderProfile.ts"
Cohesion: 0.47
Nodes (4): getAndroidMajorVersion(), RenderEnvironment, RenderProfile, selectRenderProfile()

### Community 83 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

### Community 84 - "BattlefieldArenaLayout.ts"
Cohesion: 0.50
Nodes (3): ArenaDecoration, createBattlefieldDecorations(), BattlefieldMotif

### Community 85 - "frontend-docker-packaging.test.mjs"
Cohesion: 0.50
Nodes (3): __dirname, __filename, REPO_ROOT

### Community 90 - "auth_identity_test.go"
Cohesion: 0.48
Nodes (6): authVars(), signedTelegramAuthVars(), TestValidatePlatformIdentityAcceptsMatchingBrowserGuest(), TestValidatePlatformIdentityRejectsGuestWhenDisabled(), TestValidatePlatformIdentityRejectsMismatchedBrowserGuest(), TestValidatePlatformIdentityVerifiesTelegramUserID()

### Community 93 - "capture-visual-check.mjs"
Cohesion: 0.13
Nodes (13): captureViewportScreenshot(), __dirname, DIST_DIR, __filename, main(), MIME_TYPES, REPO_ROOT, SCREENSHOTS_DIR (+5 more)

### Community 101 - "Army Visuals Rendering Optimization Report"
Cohesion: 0.29
Nodes (6): Army Visuals Rendering Optimization Report, Controlled Benchmark Results (375x667@2, 4x CPU Throttling, Hardware WebGL, Fast 4G), Executive Summary, False-Green Verification Proof, Subsystem Attribution Comparison (avg ms/frame), Visual Inspection Verification

## Knowledge Gaps
- **365 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+360 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 551 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `CareerManager.ts`, `.openLivePvpLobby`, `CareerManager`, `Analytics.ts`, `GameScene.ts`, `KingdomScene`, `TrainingScene.ts`, `NakamaClient`, `platform/src/types.ts`, `KingdomScene.ts`, `GameScene`, `BalePlatformAdapter`, `DailyScene`, `TelegramPlatformAdapter`, `daily.ts`, `BrowserPlatformAdapter`, `LeagueScene`, `EitaaPlatformAdapter`, `getSceneViewport`?**
  _High betweenness centrality (0.069) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `CareerManager.ts`, `.openLivePvpLobby`, `DailyScene`, `getSceneViewport`, `GameScene.ts`, `KingdomScene`, `.renderResultModal`, `TrainingScene.ts`, `LeagueScene`, `KingdomScene.ts`, `GameScene`, `PlatformAdapter`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `CareerManager.ts`, `LiveCombatFeedback.ts`, `pvp.ts`, `CareerManager`, `GameScene.ts`, `LiveMatchClient`, `HudLayout.ts`, `.renderResultModal`, `LiveMatchClient.ts`, `MatchMenuController`, `PlatformAdapter`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _365 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.10202020202020202 - nodes in this community are weakly interconnected._
- **Should `CareerManager.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12436974789915967 - nodes in this community are weakly interconnected._
- **Should `UpgradeModifiers` be split into smaller, more focused modules?**
  _Cohesion score 0.12962962962962962 - nodes in this community are weakly interconnected._