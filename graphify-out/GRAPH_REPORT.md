# Graph Report - crownClash  (2026-09-14)

## Corpus Check
- 189 files · ~694,505 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1737 nodes · 4259 edges · 79 communities (58 shown, 17 thin omitted)
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
- Store
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- TestGameObject
- types.go
- GameApiClient.ts
- GameScene.ts
- context.Context
- commanders.ts
- HudLayout.ts
- PlatformAdapter
- Analytics.ts
- compilerOptions
- SoundEffects
- .ClaimDailyReward
- BalePlatformAdapter
- MatchMenuController
- TelegramPlatformAdapter
- platform/src/types.ts
- GameScene
- game-core/package.json
- platform/package.json
- CareerManager.ts
- gameSceneGuards.ts
- BrowserPlatformAdapter
- generate_territories.py
- compilerOptions
- compilerOptions
- game/package.json
- generate_units.py
- DailyScene
- EitaaPlatformAdapter
- live.go
- package.json
- purchaseUpgradeThroughCareer
- PerformanceMonitor
- LiveMatchClient
- Crown Clash — Art Bible & Visual Direction
- live_pvp.smoke.mjs
- HubLayouts.ts
- BenchmarkComparator.ts
- MenuLayout.ts
- run-benchmark.mjs
- env.d.ts
- LeagueScene
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- Exact Failure Reason Outputs
- HapticImpactStyle
- False-Green Guard
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
- pvp.ts
- StartupLoadingShell.ts
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
- `LiveMatchStarted` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (79 total, 17 thin omitted)

### Community 0 - "BenchmarkAggregator.ts"
Cohesion: 0.22
Nodes (11): aggregateBenchmarkRuns(), calculateSampleStats(), DEFAULT_AGGREGATE_THRESHOLDS, formatAggregateMarkdown(), BenchmarkAggregateReport, BenchmarkReport, __dirname, __filename (+3 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (77): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+69 more)

### Community 2 - "CareerManager"
Cohesion: 0.18
Nodes (6): isLocalCareerFallbackAllowed(), CareerManager, isStaleSocketError(), createLocalBotMatchTicket(), EconomyLedgerEntry, PlayerCareer

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (69): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield() (+61 more)

### Community 4 - "mobile-stutter-diagnostics.md"
Cohesion: 0.12
Nodes (15): 1. Measured Scenario Benchmark Results, 2. Subsystem Attribution Breakdown (Measured CPU Timings), 3. Trace Window Validation & Subsystem Breakdown, 4. Measured Facts versus Inferred Explanations, 5. Projections for 2v2 and Larger Maps (Architectural Modeling), 6. Corrected Bottleneck Ranking, 7. Evidence-Supported First Optimization Recommendation, 8. Instrumentation Limitations & Transparency (+7 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.20
Nodes (7): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode()

### Community 6 - "upgrades.ts"
Cohesion: 0.06
Nodes (46): KingdomScene, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, getKingdomProgress(), KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomProgress (+38 more)

### Community 7 - "Store"
Cohesion: 0.08
Nodes (34): CommanderUnlockLevel(), findStoredLeagueClaim(), getClaimedLeagueRanks(), getRankTierForID(), LeagueState, RankTierInfo, Store, careerFromRow() (+26 more)

### Community 8 - "TutorialController"
Cohesion: 0.08
Nodes (17): Lesson, TrainingScene, createController(), createRecorder(), get(), mockLocalStorage(), isTutorialCompleted(), markTutorialCompleted() (+9 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "TestGameObject"
Cohesion: 0.08
Nodes (3): { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, TestContainer, TestGameObject

### Community 11 - "types.go"
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 12 - "GameApiClient.ts"
Cohesion: 0.07
Nodes (26): CareerApi, GameApiError, StaleSocketError, TrackedAnalyticsEvent, LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode (+18 more)

### Community 13 - "GameScene.ts"
Cohesion: 0.14
Nodes (31): trackEvent(), trackSessionStart(), trackUpgradeEvent(), sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual (+23 more)

### Community 14 - "context.Context"
Cohesion: 0.20
Nodes (19): Store, newLiveJoinCode(), newLiveMatchHandler(), beforeAuthenticateCustom(), matchmakerMatched(), rpcCreateInvite(), rpcJoinInvite(), RunMigrations() (+11 more)

### Community 15 - "commanders.ts"
Cohesion: 0.43
Nodes (5): COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId()

### Community 16 - "HudLayout.ts"
Cohesion: 0.08
Nodes (32): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+24 more)

### Community 17 - "PlatformAdapter"
Cohesion: 0.11
Nodes (3): MenuScene, dismissStartupLoadingShell(), PlatformAdapter

### Community 18 - "Analytics.ts"
Cohesion: 0.07
Nodes (23): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEvent, AnalyticsEventInput, AnalyticsPrimitive (+15 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 21 - ".ClaimDailyReward"
Cohesion: 0.17
Nodes (22): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+14 more)

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

### Community 30 - "CareerManager.ts"
Cohesion: 0.13
Nodes (16): DailyClaimRunnerHooks, result, advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, DailyClaimResult, formatDailyReset() (+8 more)

### Community 31 - "gameSceneGuards.ts"
Cohesion: 0.25
Nodes (10): trackTerminalMatchEvent(), LiveMatchResult, canFinalizeBotSettlement(), canHandleLiveSettlement(), canInitiateBotSettlement(), LiveSettlementGateOptions, processLiveMatchResult(), SettlementGateOptions (+2 more)

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
Nodes (26): dependencies, @crown-clash/game-core, @crown-clash/platform, @heroiclabs/nakama-js, phaser, devDependencies, @types/node, typescript (+18 more)

### Community 37 - "generate_units.py"
Cohesion: 0.31
Nodes (10): assign_material(), build_toy_knight(), clear_mesh_objects(), get_or_create_material(), main(), Crown Clash - 2.5D Army Unit Token Generator Generates and renders stylized…, Builds a stylized 2.5D toy knight warrior figurine: - Round beveled plinth -…, render_sprite() (+2 more)

### Community 40 - "live.go"
Cohesion: 0.16
Nodes (19): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Team, liveArmyID(), livePlayerMatchID(), mapTeamForRole() (+11 more)

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "purchaseUpgradeThroughCareer"
Cohesion: 0.19
Nodes (7): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, purchaseUpgradeThroughCareer(), UpgradeCareerSource, createDefaultCareer(), isUpgradeMilestoneLevel()

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (23): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+15 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "live_pvp.smoke.mjs"
Cohesion: 0.51
Nodes (9): assert(), cleanDatabaseForPlayer(), parseRpcPayload(), queryDbMatchSettlementRow(), queryPostgres(), runSmokeTest(), sleep(), verifyZeroRemainingRows() (+1 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.16
Nodes (14): CommanderScene, CommanderLayout, computeCommanderLayout(), computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout (+6 more)

### Community 48 - "BenchmarkComparator.ts"
Cohesion: 0.15
Nodes (12): calculateMetricDelta(), compareBenchmarks(), CompareOptions, BenchmarkComparisonResult, MetricDelta, __dirname, __filename, REPO_ROOT (+4 more)

### Community 49 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

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

### Community 72 - ".renderResultModal"
Cohesion: 0.24
Nodes (3): wholeMatchSeconds(), computeResultRankPresentation(), ResultRankPresentation

### Community 73 - "RenderProfile.ts"
Cohesion: 0.47
Nodes (4): getAndroidMajorVersion(), RenderEnvironment, RenderProfile, selectRenderProfile()

### Community 74 - "pvp.ts"
Cohesion: 0.05
Nodes (75): LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction() (+67 more)

### Community 75 - "StartupLoadingShell.ts"
Cohesion: 0.52
Nodes (5): isStartupLoadingShellDismissed(), LOADING_SHELL_HIDDEN_CLASS, LOADING_SHELL_ID, resetStartupLoadingShellStateForTesting(), UI_READY_MARK

### Community 76 - "main.go"
Cohesion: 0.17
Nodes (32): afterAuthenticateCustom(), analyticsProperties(), analyticsPropertiesWithDuration(), PvpAction, Store, InitModule(), loadServerConfig(), parseActionPayload() (+24 more)

### Community 93 - "capture-visual-check.mjs"
Cohesion: 0.13
Nodes (13): captureViewportScreenshot(), __dirname, DIST_DIR, __filename, main(), MIME_TYPES, REPO_ROOT, SCREENSHOTS_DIR (+5 more)

### Community 101 - "Army Visuals Rendering Optimization Report"
Cohesion: 0.29
Nodes (6): Army Visuals Rendering Optimization Report, Controlled Benchmark Results (375x667@2, 4x CPU Throttling, Hardware WebGL, Fast 4G), Executive Summary, False-Green Verification Proof, Subsystem Attribution Comparison (avg ms/frame), Visual Inspection Verification

## Knowledge Gaps
- **353 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+348 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 538 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **17 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `BrowserPlatformAdapter`, `CareerManager`, `.openLivePvpLobby`, `DailyScene`, `upgrades.ts`, `TutorialController`, `EitaaPlatformAdapter`, `purchaseUpgradeThroughCareer`, `GameApiClient.ts`, `GameScene.ts`, `HubLayouts.ts`, `LeagueScene`, `BalePlatformAdapter`, `TelegramPlatformAdapter`, `platform/src/types.ts`, `GameScene`, `CareerManager.ts`?**
  _High betweenness centrality (0.064) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `.openLivePvpLobby`, `DailyScene`, `upgrades.ts`, `.renderResultModal`, `GameApiClient.ts`, `GameScene.ts`, `HubLayouts.ts`, `PlatformAdapter`, `LeagueScene`, `GameScene`, `CareerManager.ts`?**
  _High betweenness centrality (0.037) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `CareerManager`, `.renderResultModal`, `.create`, `pvp.ts`, `LiveMatchClient`, `GameScene.ts`, `GameApiClient.ts`, `HudLayout.ts`, `PlatformAdapter`, `MatchMenuController`, `.setupInputs`, `.finalizeMatch`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _353 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.05663474692202462 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07785602503912363 - nodes in this community are weakly interconnected._
- **Should `mobile-stutter-diagnostics.md` be split into smaller, more focused modules?**
  _Cohesion score 0.125 - nodes in this community are weakly interconnected._