# Graph Report - crownClash  (2026-09-13)

## Corpus Check
- 170 files · ~145,703 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1680 nodes · 4161 edges · 72 communities (53 shown, 18 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `9ed2447a`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- BenchmarkAggregator.ts
- testing.T
- UpgradePurchaseController.ts
- domain.go
- mobile-stutter-diagnostics.md
- .openLivePvpLobby
- upgrades.ts
- context.Context
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- TestGameObject
- types.go
- CareerManager
- NakamaClient
- GameScene.ts
- KingdomScene
- HudLayout.ts
- GameApiClient.ts
- AnalyticsSink
- compilerOptions
- SoundEffects
- BalePlatformAdapter
- BrowserPlatformAdapter
- MatchMenuController
- pvp.ts
- platform/src/types.ts
- Analytics.ts
- GameScene
- game-core/package.json
- platform/package.json
- UpgradeType
- EitaaPlatformAdapter
- TelegramPlatformAdapter
- generate_territories.py
- compilerOptions
- compilerOptions
- game/package.json
- generate_units.py
- DailyScene
- CareerManager.ts
- DailyRewardType
- package.json
- HapticImpactStyle
- PerformanceMonitor
- PlatformAdapter
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- FalseGreenControls.test.ts
- TrainingScene
- run-benchmark.mjs
- env.d.ts
- LeagueScene
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- Exact Failure Reason Outputs
- LiveMatchClient.ts
- MenuLayout.ts
- False-Green Guard
- getSceneViewport
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md
- Benchmark Multi-Run Aggregation Report: normal_combat
- BenchmarkTypes.ts
- BenchmarkMetricsCalculator.ts
- DeterministicScenarioDriver.ts
- False-Green Diagnostic Verification Report

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
- `successResult()` --calls--> `createDefaultCareer()`  [EXTRACTED]
  apps/game/src/upgrades/__tests__/UpgradePurchaseController.test.ts → packages/game-core/src/progression.ts
- `LiveMatchResult` --references--> `MatchSettlement`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/progression.ts
- `LiveMatchResult` --references--> `MatchStats`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (72 total, 18 thin omitted)

### Community 0 - "BenchmarkAggregator.ts"
Cohesion: 0.19
Nodes (12): aggregateBenchmarkRuns(), calculateSampleStats(), DEFAULT_AGGREGATE_THRESHOLDS, formatAggregateMarkdown(), BenchmarkAggregateReport, BenchmarkAggregateThresholds, MetricAggregateStats, __dirname (+4 more)

### Community 1 - "testing.T"
Cohesion: 0.07
Nodes (67): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+59 more)

### Community 2 - "UpgradePurchaseController.ts"
Cohesion: 0.20
Nodes (7): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, purchaseUpgradeThroughCareer(), UpgradeCareerSource, UpgradePurchaseCallbacks, isUpgradeMilestoneLevel()

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (68): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CommanderUnlockLevel(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState() (+60 more)

### Community 4 - "mobile-stutter-diagnostics.md"
Cohesion: 0.12
Nodes (16): 1. Scenario Benchmark Results, 2. Subsystem Attribution Breakdown, 3. Deep Trace Window Analysis (Worst Hitches), 4. Root Causes & Ranked Bottlenecks, 5. Scaling Hazards: 2v2 and Larger Maps, 6. Recommended First Optimization Target, 7. False-Green Guard Verification Summary, Executive Summary (+8 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.10
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.08
Nodes (46): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId(), KINGDOM_TIERS, KINGDOM_UPGRADES (+38 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (57): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+49 more)

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
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 12 - "CareerManager"
Cohesion: 0.20
Nodes (3): CareerManager, EconomyLedgerEntry, PlayerCareer

### Community 14 - "GameScene.ts"
Cohesion: 0.17
Nodes (24): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+16 more)

### Community 15 - "KingdomScene"
Cohesion: 0.22
Nodes (3): KingdomScene, getKingdomProgress(), KingdomProgress

### Community 16 - "HudLayout.ts"
Cohesion: 0.09
Nodes (30): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+22 more)

### Community 17 - "GameApiClient.ts"
Cohesion: 0.13
Nodes (12): CareerApi, GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), getSharedGameApiClient(), BotMatchTicket (+4 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 24 - "pvp.ts"
Cohesion: 0.06
Nodes (70): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies() (+62 more)

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (9): Window, Window, Window, HapticNotificationType, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType (+1 more)

### Community 26 - "Analytics.ts"
Cohesion: 0.12
Nodes (17): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+9 more)

### Community 27 - "GameScene"
Cohesion: 0.05
Nodes (15): trackTerminalMatchEvent(), LiveMatchClient, LiveMatchResult, parseLiveErrorCode(), wholeMatchSeconds(), GameScene, canFinalizeBotSettlement(), canHandleLiveSettlement() (+7 more)

### Community 28 - "game-core/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 29 - "platform/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 30 - "UpgradeType"
Cohesion: 0.20
Nodes (5): ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, UpgradePurchaseResult, UpgradeType

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

### Community 39 - "CareerManager.ts"
Cohesion: 0.16
Nodes (18): isLocalCareerFallbackAllowed(), isStaleSocketError(), localStorageMock, storage, createLocalBotMatchTicket(), advanceDailyState(), claimDailyRewardLocally(), createDailyState() (+10 more)

### Community 40 - "DailyRewardType"
Cohesion: 0.30
Nodes (4): DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (26): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+18 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.06
Nodes (79): ExtractUnverifiedUser(), extractUser(), stringifyUserID(), VerifyTelegramStyleInitData(), canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer (+71 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.25
Nodes (11): CommanderLayout, computeCommanderLayout(), computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X (+3 more)

### Community 48 - "FalseGreenControls.test.ts"
Cohesion: 0.21
Nodes (10): calculateMetricDelta(), compareBenchmarks(), CompareOptions, BenchmarkComparisonResult, BenchmarkMetrics, BenchmarkReport, MetricDelta, createMockReport() (+2 more)

### Community 49 - "TrainingScene"
Cohesion: 0.27
Nodes (3): Lesson, TrainingScene, TutorialStepId

### Community 50 - "run-benchmark.mjs"
Cohesion: 0.21
Nodes (10): CdpClient, __dirname, DIST_DIR, __filename, MIME_TYPES, REPO_ROOT, runDeterministicBenchmark(), sleep() (+2 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "Exact Failure Reason Outputs"
Cohesion: 0.14
Nodes (13): Exact Failure Reason Outputs, False-Green Guard Verification Report, NC-1: Software WebGL, NC-2: Army Count > 10, NC-3: Seed Mismatch, NC-4: CPU Throttle Mismatch, NC-5: Network Profile Mismatch, NC-6: Scenario Name Mismatch (+5 more)

### Community 58 - "LiveMatchClient.ts"
Cohesion: 0.25
Nodes (8): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResultConsumerContext, MatchSettlement, PvpAction, MatchStats

### Community 59 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 61 - "getSceneViewport"
Cohesion: 0.35
Nodes (3): CommanderScene, getSceneViewport(), getKingdomLevel()

### Community 64 - "Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist"
Cohesion: 0.13
Nodes (14): 1. Device Matrix, 2. Preparation & Launch, 3. Real-Device QA Test Protocol, 4. Adverse Network Verification, 5. Performance Acceptance Thresholds, 6. QA Session Report Template, A. Local Network & Dev Server, B. Launch Modes & Query Parameters (+6 more)

### Community 68 - "BenchmarkTypes.ts"
Cohesion: 0.17
Nodes (11): BenchmarkBuildMode, BenchmarkComparisonSuccess, BenchmarkEnvironment, BenchmarkRendererType, BenchmarkVerificationResult, ComparisonRejection, ComparisonRejectionReasonCode, DeltaPercentiles (+3 more)

### Community 69 - "BenchmarkMetricsCalculator.ts"
Cohesion: 0.38
Nodes (8): calculatePercentiles(), computeBenchmarkMetrics(), processAndDeduplicateFrames(), RawArmySample, RawBenchmarkSampleInput, RawFrameSample, verifyPrerequisites(), BenchmarkPrerequisites

### Community 70 - "DeterministicScenarioDriver.ts"
Cohesion: 0.33
Nodes (7): BenchmarkScenarioConfig, BenchmarkScenarioName, computeScheduleHash(), createMulberry32(), DeterministicScenarioDefinition, SCENARIO_DEFINITIONS, ScriptedDispatch

### Community 71 - "False-Green Diagnostic Verification Report"
Cohesion: 0.40
Nodes (4): 1. Negative Control (Injected 75ms Long Task), 2. Restored Clean Control (No Injection), False-Green Diagnostic Verification Report, Objective

## Knowledge Gaps
- **332 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+327 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 510 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `UpgradePurchaseController.ts`, `.openLivePvpLobby`, `CareerManager`, `NakamaClient`, `GameScene.ts`, `KingdomScene`, `GameApiClient.ts`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `GameScene`, `EitaaPlatformAdapter`, `TelegramPlatformAdapter`, `DailyScene`, `CareerManager.ts`, `TrainingScene`, `LeagueScene`, `LiveMatchClient.ts`, `getSceneViewport`?**
  _High betweenness centrality (0.061) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `.openLivePvpLobby`, `DailyScene`, `CareerManager.ts`, `GameScene.ts`, `KingdomScene`, `GameApiClient.ts`, `LeagueScene`, `LiveMatchClient.ts`, `GameScene`, `getSceneViewport`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **Why does `createPlatformAdapter()` connect `GameScene.ts` to `TelegramPlatformAdapter`, `.openLivePvpLobby`, `DailyScene`, `HapticImpactStyle`, `KingdomScene`, `TrainingScene`, `LeagueScene`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `GameScene`, `getSceneViewport`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _332 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.06702702702702702 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07766599597585513 - nodes in this community are weakly interconnected._
- **Should `mobile-stutter-diagnostics.md` be split into smaller, more focused modules?**
  _Cohesion score 0.11764705882352941 - nodes in this community are weakly interconnected._