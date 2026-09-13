# Graph Report - crownClash  (2026-09-13)

## Corpus Check
- 189 files · ~691,685 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1732 nodes · 4241 edges · 78 communities (54 shown, 23 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `673d3a10`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- BenchmarkAggregator.ts
- testing.T
- CareerManager
- domain.go
- mobile-stutter-diagnostics.md
- .openLivePvpLobby
- upgrades.ts
- context.Context
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- TestGameObject
- types.go
- CareerManager.ts
- GameScene.ts
- Analytics.ts
- commanders.ts
- HudLayout.ts
- PlatformAdapter
- AnalyticsSink
- compilerOptions
- SoundEffects
- MenuScene.ts
- BalePlatformAdapter
- MatchMenuController
- TelegramPlatformAdapter
- platform/src/types.ts
- .bindLiveMatch
- GameScene
- game-core/package.json
- platform/package.json
- daily.ts
- LiveMatchClient.ts
- BrowserPlatformAdapter
- generate_territories.py
- compilerOptions
- compilerOptions
- game/package.json
- generate_units.py
- DailyScene
- EitaaPlatformAdapter
- NakamaClient
- package.json
- DailyRewardType
- PerformanceMonitor
- LiveMatchClient
- Crown Clash — Art Bible & Visual Direction
- TrainingScene
- HubLayouts.ts
- BenchmarkComparator.ts
- LOGICAL_HEIGHT
- run-benchmark.mjs
- env.d.ts
- LeagueScene
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- Exact Failure Reason Outputs
- HapticImpactStyle
- CommanderScene
- False-Green Guard
- .finalizeMatch
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md
- Benchmark Multi-Run Aggregation Report: normal_combat
- BenchmarkTypes.ts
- BenchmarkMetricsCalculator.ts
- DeterministicScenarioDriver.ts
- False-Green Diagnostic Verification Report
- .renderResultModal
- RenderProfile.ts
- game-core/src/index.ts
- main.go
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
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (78 total, 23 thin omitted)

### Community 0 - "BenchmarkAggregator.ts"
Cohesion: 0.22
Nodes (11): aggregateBenchmarkRuns(), calculateSampleStats(), DEFAULT_AGGREGATE_THRESHOLDS, formatAggregateMarkdown(), BenchmarkAggregateReport, BenchmarkReport, __dirname, __filename (+3 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (75): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+67 more)

### Community 2 - "CareerManager"
Cohesion: 0.21
Nodes (3): CareerManager, EconomyLedgerEntry, PlayerCareer

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (68): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CommanderUnlockLevel(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState() (+60 more)

### Community 4 - "mobile-stutter-diagnostics.md"
Cohesion: 0.12
Nodes (15): 1. Measured Scenario Benchmark Results, 2. Subsystem Attribution Breakdown (Measured CPU Timings), 3. Trace Window Validation & Subsystem Breakdown, 4. Measured Facts versus Inferred Explanations, 5. Projections for 2v2 and Larger Maps (Architectural Modeling), 6. Corrected Bottleneck Ranking, 7. Evidence-Supported First Optimization Recommendation, 8. Instrumentation Limitations & Transparency (+7 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.11
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.05
Nodes (50): KingdomScene, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, purchaseUpgradeThroughCareer(), UpgradeCareerSource, getKingdomProgress(), KINGDOM_TIERS (+42 more)

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

### Community 12 - "CareerManager.ts"
Cohesion: 0.12
Nodes (19): CareerApi, GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), getSharedGameApiClient(), isStaleSocketError() (+11 more)

### Community 13 - "GameScene.ts"
Cohesion: 0.14
Nodes (15): trackUpgradeEvent(), sounds, ArmyFollower, ArmyVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2, MockImage, MockRectangle, MockEllipse, MockCircle, MockText }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, computeResultRankPresentation() (+7 more)

### Community 14 - "Analytics.ts"
Cohesion: 0.10
Nodes (18): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+10 more)

### Community 15 - "commanders.ts"
Cohesion: 0.19
Nodes (10): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked() (+2 more)

### Community 16 - "HudLayout.ts"
Cohesion: 0.08
Nodes (32): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+24 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 21 - "MenuScene.ts"
Cohesion: 0.35
Nodes (12): platform, MISSION_ICONS, LESSONS, TeamVisualTheme, THEME, bindSceneViewportResize(), getSceneViewport(), SceneViewport (+4 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 28 - "game-core/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 29 - "platform/package.json"
Cohesion: 0.12
Nodes (16): devDependencies, typescript, vitest, typescript, vitest, main, name, private (+8 more)

### Community 30 - "daily.ts"
Cohesion: 0.21
Nodes (12): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+4 more)

### Community 31 - "LiveMatchClient.ts"
Cohesion: 0.19
Nodes (12): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, parseLiveErrorCode(), canHandleLiveSettlement(), LiveSettlementGateOptions (+4 more)

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

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "DailyRewardType"
Cohesion: 0.27
Nodes (4): DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (26): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+18 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

### Community 48 - "BenchmarkComparator.ts"
Cohesion: 0.15
Nodes (12): calculateMetricDelta(), compareBenchmarks(), CompareOptions, BenchmarkComparisonResult, MetricDelta, __dirname, __filename, REPO_ROOT (+4 more)

### Community 49 - "LOGICAL_HEIGHT"
Cohesion: 0.17
Nodes (7): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS, ExpandSimulationResult, CenteredViewportSimulation, LOGICAL_HEIGHT

### Community 50 - "run-benchmark.mjs"
Cohesion: 0.21
Nodes (10): CdpClient, __dirname, DIST_DIR, __filename, MIME_TYPES, REPO_ROOT, runDeterministicBenchmark(), sleep() (+2 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "Exact Failure Reason Outputs"
Cohesion: 0.14
Nodes (13): Exact Failure Reason Outputs, False-Green Guard Verification Report, NC-1: Software WebGL, NC-2: Army Count > 10, NC-3: Seed Mismatch, NC-4: CPU Throttle Mismatch, NC-5: Network Profile Mismatch, NC-6: Scenario Name Mismatch (+5 more)

### Community 58 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 59 - "CommanderScene"
Cohesion: 0.42
Nodes (3): CommanderScene, computeCommanderLayout(), getKingdomLevel()

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

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

### Community 73 - "RenderProfile.ts"
Cohesion: 0.47
Nodes (4): getAndroidMajorVersion(), RenderEnvironment, RenderProfile, selectRenderProfile()

### Community 74 - "game-core/src/index.ts"
Cohesion: 0.06
Nodes (71): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies() (+63 more)

### Community 76 - "main.go"
Cohesion: 0.06
Nodes (71): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Store, Team, liveArmyID(), livePlayerMatchID() (+63 more)

### Community 93 - "capture-visual-check.mjs"
Cohesion: 0.13
Nodes (13): captureViewportScreenshot(), __dirname, DIST_DIR, __filename, main(), MIME_TYPES, REPO_ROOT, SCREENSHOTS_DIR (+5 more)

### Community 101 - "Army Visuals Rendering Optimization Report"
Cohesion: 0.29
Nodes (6): Army Visuals Rendering Optimization Report, Controlled Benchmark Results (375x667@2, 4x CPU Throttling, Hardware WebGL, Fast 4G), Executive Summary, False-Green Verification Proof, Subsystem Attribution Comparison (avg ms/frame), Visual Inspection Verification

## Knowledge Gaps
- **353 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+348 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 538 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **23 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `BrowserPlatformAdapter`, `CareerManager`, `.openLivePvpLobby`, `DailyScene`, `upgrades.ts`, `GameScene`, `EitaaPlatformAdapter`, `CareerManager.ts`, `GameScene.ts`, `TrainingScene`, `commanders.ts`, `LeagueScene`, `MenuScene.ts`, `BalePlatformAdapter`, `TelegramPlatformAdapter`, `platform/src/types.ts`, `CommanderScene`?**
  _High betweenness centrality (0.060) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `.openLivePvpLobby`, `DailyScene`, `upgrades.ts`, `GameScene`, `.renderResultModal`, `DailyRewardType`, `CareerManager.ts`, `GameScene.ts`, `TrainingScene`, `PlatformAdapter`, `LeagueScene`, `MenuScene.ts`, `CommanderScene`, `daily.ts`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `CareerManager`, `.renderResultModal`, `game-core/src/index.ts`, `LiveMatchClient`, `GameScene.ts`, `CareerManager.ts`, `HudLayout.ts`, `PlatformAdapter`, `MenuScene.ts`, `MatchMenuController`, `.bindLiveMatch`, `.finalizeMatch`?**
  _High betweenness centrality (0.028) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _353 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.058519793459552494 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07766599597585513 - nodes in this community are weakly interconnected._
- **Should `mobile-stutter-diagnostics.md` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._