# Graph Report - crownClash  (2026-09-13)

## Corpus Check
- 230 files · ~544,974 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 2377 nodes · 5644 edges · 134 communities (101 shown, 32 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 297 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `8126df13`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- BenchmarkAggregator.ts
- testing.T
- bindings_main.js
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
- CareerManager.ts
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
- daily.ts
- DailyRewardType
- package.json
- HapticImpactStyle
- PerformanceMonitor
- PlatformAdapter
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- BenchmarkComparator.ts
- TrainingScene
- run-benchmark.mjs
- env.d.ts
- LeagueScene
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- Exact Failure Reason Outputs
- commanders.ts
- MenuLayout.ts
- False-Green Guard
- background_compiled.js
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md
- Benchmark Multi-Run Aggregation Report: normal_combat
- BenchmarkTypes.ts
- BenchmarkMetricsCalculator.ts
- DeterministicScenarioDriver.ts
- False-Green Diagnostic Verification Report
- offscreen_compiled.js
- d
- game-core/src/types.ts
- assert
- database/sql.DB
- .ClaimDailyReward
- DefaultModifiers
- .C
- LiveMatchClient.ts
- live.go
- mf
- .F
- cf
- assignWasmImports
- abort
- r
- jc
- TutorialController.ts
- validatePlatformIdentity
- bc
- parseAnalyticsEventsPayload
- capture-visual-check.mjs
- LiveMatchClient
- LiveCombatFeedback.ts
- resolveArrival
- ExceptionInfo
- getSceneViewport
- run
- .throw
- Army Visuals Rendering Optimization Report
- StreamingWorkletProcessor
- 1.1.0.3/manifest.json
- 2026.9.10.80/manifest.json
- 742/manifest.json
- 9.71.0/manifest.json
- 9.5220.3721/manifest.json
- 4/manifest.json
- 8.5419.4434/manifest.json
- 10773/manifest.json
- 145.0.7584.0/manifest.json
- 2025.7.24.0/manifest.json
- 120.0.6050.0/manifest.json
- 20251024.824731831.14/manifest.json
- 1773/manifest.json
- 3091/manifest.json
- 7/manifest.json
- 2026.8.3.1/manifest.json
- ___syscall_ioctl
- 20260826.1/manifest.json
- 3/manifest.json
- wholeMatchSeconds
- RunMigrations
- close
- mount
- dbg
- readlink
- link
- llseek
- lookup
- readdir
- symlink
- unlink

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 70 edges
2. `CareerManager` - 56 edges
3. `PlatformAdapter` - 56 edges
4. `BrowserPlatformAdapter` - 32 edges
5. `assert()` - 32 edges
6. `getSceneViewport()` - 30 edges
7. `NewStore()` - 30 edges
8. `d()` - 30 edges
9. `BalePlatformAdapter` - 29 edges
10. `EitaaPlatformAdapter` - 29 edges

## Surprising Connections (you probably didn't know these)
- `successResult()` --calls--> `createDefaultCareer()`  [EXTRACTED]
  apps/game/src/upgrades/__tests__/UpgradePurchaseController.test.ts → packages/game-core/src/progression.ts
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

## Communities (134 total, 32 thin omitted)

### Community 0 - "BenchmarkAggregator.ts"
Cohesion: 0.22
Nodes (11): aggregateBenchmarkRuns(), calculateSampleStats(), DEFAULT_AGGREGATE_THRESHOLDS, formatAggregateMarkdown(), BenchmarkAggregateReport, BenchmarkReport, __dirname, __filename (+3 more)

### Community 1 - "testing.T"
Cohesion: 0.09
Nodes (46): analyticsPropsJSON(), TestInsertAnalyticsEventsCommitsWholeBatch(), TestInsertAnalyticsEventsIsIdempotentByPlayerAndEventID(), TestInsertAnalyticsEventsNormalizesDailyRewardFromClaim(), TestInsertAnalyticsEventsNormalizesLeagueRewardFromClaim(), TestInsertAnalyticsEventsNormalizesMatchEndFromSettlement(), TestInsertAnalyticsEventsNormalizesRankPromotionFromSettlement(), TestInsertAnalyticsEventsNormalizesRewardFromSettlement() (+38 more)

### Community 2 - "bindings_main.js"
Cohesion: 0.02
Nodes (20): RFC-2279, RFC-3629, EmscriptenEH, EmscriptenSjLj, ioctl(), missingLibrarySymbol(), mknod(), NOTE: In our implementation, st_blocks = Math.ceil(st_size/st_blksize), (+12 more)

### Community 3 - "domain.go"
Cohesion: 0.14
Nodes (32): BuildLeagueState(), CalculateMatchRewards(), CreateDefaultCareer(), GetRankTier(), LeagueState, MatchSettlement, MatchStats, PlayerCareer (+24 more)

### Community 4 - "mobile-stutter-diagnostics.md"
Cohesion: 0.12
Nodes (15): 1. Measured Scenario Benchmark Results, 2. Subsystem Attribution Breakdown (Measured CPU Timings), 3. Trace Window Validation & Subsystem Breakdown, 4. Measured Facts versus Inferred Explanations, 5. Projections for 2v2 and Larger Maps (Architectural Modeling), 6. Corrected Bottleneck Ranking, 7. Evidence-Supported First Optimization Recommendation, 8. Instrumentation Limitations & Transparency (+7 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.10
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.10
Nodes (42): KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomTier, KingdomTierId, MAX_KINGDOM_LEVEL, claimLeagueRewardLocally(), createLeagueState(), getKingdomPower() (+34 more)

### Community 7 - "context.Context"
Cohesion: 0.09
Nodes (35): CommanderUnlockLevel(), findStoredLeagueClaim(), getClaimedLeagueRanks(), getRankTierForID(), LeagueState, RankTierInfo, Store, careerFromRow() (+27 more)

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
Cohesion: 0.17
Nodes (5): isLocalCareerFallbackAllowed(), CareerManager, isStaleSocketError(), createLocalBotMatchTicket(), PlayerCareer

### Community 14 - "GameScene.ts"
Cohesion: 0.15
Nodes (26): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2, MockImage, MockRectangle, MockEllipse, MockCircle, MockText }, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 } (+18 more)

### Community 15 - "KingdomScene"
Cohesion: 0.22
Nodes (3): KingdomScene, getKingdomProgress(), KingdomProgress

### Community 16 - "HudLayout.ts"
Cohesion: 0.09
Nodes (31): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+23 more)

### Community 17 - "CareerManager.ts"
Cohesion: 0.12
Nodes (19): CareerApi, GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), getSharedGameApiClient(), localStorageMock (+11 more)

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
Cohesion: 0.11
Nodes (29): BattlefieldDefinition, BattlefieldId, BATTLEFIELDS, DEFAULT_BATTLEFIELD_ID, getBattlefield(), normalizeBattlefieldId(), createDefaultTerritories(), dispatchFromState() (+21 more)

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.08
Nodes (23): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+15 more)

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

### Community 39 - "daily.ts"
Cohesion: 0.21
Nodes (12): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+4 more)

### Community 40 - "DailyRewardType"
Cohesion: 0.21
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

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.17
Nodes (33): afterAuthenticateCustom(), analyticsProperties(), analyticsPropertiesWithDuration(), PvpAction, Store, identityFromUsername(), InitModule(), loadServerConfig() (+25 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

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

### Community 58 - "commanders.ts"
Cohesion: 0.36
Nodes (6): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId()

### Community 59 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 61 - "background_compiled.js"
Cohesion: 0.06
Nodes (39): A(), B(), C(), ca(), da(), E(), ea(), F() (+31 more)

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

### Community 72 - "offscreen_compiled.js"
Cohesion: 0.07
Nodes (37): Ah(), Bd(), bh(), Cd(), cg(), ch(), dg(), fc() (+29 more)

### Community 73 - "d"
Cohesion: 0.10
Nodes (19): Aa(), b(), c(), d(), e(), f(), m(), c() (+11 more)

### Community 74 - "game-core/src/types.ts"
Cohesion: 0.12
Nodes (29): LiveReconciliationResult, StressDispatchPair, TerritoryVisual, AiMove, evaluateAiMove(), resolveArrival(), BASE_ARMY_TRAVEL_SPEED, calculateDispatchUnits() (+21 more)

### Community 75 - "assert"
Cohesion: 0.09
Nodes (32): assert(), assignWasmExports(), createExportWrapper(), createNode(), createStandardStreams(), createStream(), createWasm(), receiveInstance() (+24 more)

### Community 76 - "database/sql.DB"
Cohesion: 0.19
Nodes (17): Store, newLiveJoinCode(), newLiveMatchHandler(), beforeAuthenticateCustom(), matchmakerMatched(), rpcCreateInvite(), rpcJoinInvite(), database/sql.DB (+9 more)

### Community 77 - ".ClaimDailyReward"
Cohesion: 0.17
Nodes (22): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+14 more)

### Community 78 - "DefaultModifiers"
Cohesion: 0.19
Nodes (24): calculateDispatchUnits(), CreateInitialGameState(), CreateInitialGameStateForBattlefield(), DefaultModifiers(), dispatchArmy(), evaluateAIMove(), GameState, PvpAction (+16 more)

### Community 79 - ".C"
Cohesion: 0.21
Nodes (16): dh(), Eh(), J(), Kh(), ma(), oh(), ph(), q() (+8 more)

### Community 80 - "LiveMatchClient.ts"
Cohesion: 0.14
Nodes (19): trackTerminalMatchEvent(), LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, LiveMatchStarted, LiveServerPayload (+11 more)

### Community 81 - "live.go"
Cohesion: 0.17
Nodes (19): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Team, liveArmyID(), livePlayerMatchID(), mapTeamForRole() (+11 more)

### Community 82 - "mf"
Cohesion: 0.15
Nodes (22): $a(), ab(), bb(), cb(), db(), eb(), Ed(), fb() (+14 more)

### Community 83 - ".F"
Cohesion: 0.16
Nodes (19): ae(), be(), ce(), de(), ee(), fd(), fe(), gd() (+11 more)

### Community 84 - "cf"
Cohesion: 0.16
Nodes (21): cf(), Da(), df(), ef(), ff(), gf(), hf(), je() (+13 more)

### Community 85 - "assignWasmImports"
Cohesion: 0.10
Nodes (20): assignWasmImports(), _clock_time_get(), EnsureDir(), _environ_get(), _environ_sizes_get(), ExitStatus, _fd_close(), _fd_read() (+12 more)

### Community 86 - "abort"
Cohesion: 0.13
Nodes (17): abort(), checkIncomingModuleAPI(), createLazyFile(), stream_ops, writeChunks(), forceLoadFile(), get(), get_char() (+9 more)

### Community 87 - "r"
Cohesion: 0.11
Nodes (3): qa(), r(), ra()

### Community 88 - "jc"
Cohesion: 0.16
Nodes (18): af(), bf(), Gc(), hc(), ic(), jc(), kc(), Nd() (+10 more)

### Community 89 - "TutorialController.ts"
Cohesion: 0.18
Nodes (15): Lesson, createController(), createRecorder(), get(), mockLocalStorage(), isTutorialCompleted(), markTutorialCompleted(), STEP_DEFINITIONS (+7 more)

### Community 90 - "validatePlatformIdentity"
Cohesion: 0.23
Nodes (14): ExtractUnverifiedUser(), extractUser(), authVars(), signedTelegramAuthVars(), TestValidatePlatformIdentityAcceptsMatchingBrowserGuest(), TestValidatePlatformIdentityRejectsGuestWhenDisabled(), TestValidatePlatformIdentityRejectsMismatchedBrowserGuest(), TestValidatePlatformIdentityVerifiesTelegramUserID() (+6 more)

### Community 91 - "bc"
Cohesion: 0.18
Nodes (13): Ac(), ag(), bc(), bg(), cc(), dc(), ec(), ge() (+5 more)

### Community 92 - "parseAnalyticsEventsPayload"
Cohesion: 0.30
Nodes (14): analyticsPayload(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps(), TestAnalyticsPayloadAcceptsValidEvent() (+6 more)

### Community 93 - "capture-visual-check.mjs"
Cohesion: 0.20
Nodes (11): captureViewportScreenshot(), CdpClient, __dirname, DIST_DIR, __filename, main(), MIME_TYPES, REPO_ROOT (+3 more)

### Community 95 - "LiveCombatFeedback.ts"
Cohesion: 0.25
Nodes (9): applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction(), stepLiveArmies(), StepResult (+1 more)

### Community 96 - "resolveArrival"
Cohesion: 0.24
Nodes (13): TestBattlefieldLayoutsStaySymmetricAndDistinct(), applyTerritoryLayout(), CreateDefaultTerritories(), CreateTerritoriesForBattlefield(), Team, remainingDefenders(), resolveArrival(), territoryArmySpeedMultiplier() (+5 more)

### Community 98 - "getSceneViewport"
Cohesion: 0.39
Nodes (4): CommanderScene, computeCommanderLayout(), getSceneViewport(), getKingdomLevel()

### Community 99 - "run"
Cohesion: 0.27
Nodes (10): checkStackCookie(), consumedModuleProp(), initRuntime(), initWorkerLogging(), getLogPrefix(), postRun(), preRun(), ptrToString() (+2 more)

### Community 100 - ".throw"
Cohesion: 0.47
Nodes (7): na(), oa(), pa(), sa(), ta(), ua(), va()

### Community 101 - "Army Visuals Rendering Optimization Report"
Cohesion: 0.29
Nodes (6): Army Visuals Rendering Optimization Report, Controlled Benchmark Results (375x667@2, 4x CPU Throttling, Hardware WebGL, Fast 4G), Executive Summary, False-Green Verification Proof, Subsystem Attribution Comparison (avg ms/frame), Visual Inspection Verification

### Community 102 - "StreamingWorkletProcessor"
Cohesion: 0.29
Nodes (3): TODO: add type annotations, TODO: find externs so we can use @override., StreamingWorkletProcessor

### Community 103 - "1.1.0.3/manifest.json"
Cohesion: 0.33
Nodes (5): description, manifest_version, name, update_url, version

### Community 104 - "2026.9.10.80/manifest.json"
Cohesion: 0.40
Nodes (4): manifest_version, name, preload_data_format, version

### Community 105 - "742/manifest.json"
Cohesion: 0.40
Nodes (4): manifest_version, name, ruleset_format, version

### Community 106 - "9.71.0/manifest.json"
Cohesion: 0.40
Nodes (4): manifest_version, name, ruleset_format, version

### Community 107 - "9.5220.3721/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 108 - "4/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 109 - "8.5419.4434/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 110 - "10773/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 111 - "145.0.7584.0/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 112 - "2025.7.24.0/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 113 - "120.0.6050.0/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 114 - "20251024.824731831.14/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 115 - "1773/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 116 - "3091/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 117 - "7/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 118 - "2026.8.3.1/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 119 - "___syscall_ioctl"
Cohesion: 0.50
Nodes (4): ioctl_tcgets(), ioctl_tcsets(), ioctl_tiocgwinsz(), ___syscall_ioctl()

### Community 120 - "20260826.1/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 121 - "3/manifest.json"
Cohesion: 0.50
Nodes (3): manifest_version, name, version

### Community 124 - "close"
Cohesion: 1.33
Nodes (3): close(), fsync(), notifyListeners()

### Community 125 - "mount"
Cohesion: 1.00
Nodes (3): mount(), onPersistComplete(), startPersist()

## Knowledge Gaps
- **411 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+406 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 760 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **32 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `getSceneViewport`, `.openLivePvpLobby`, `DailyScene`, `CareerManager`, `GameScene.ts`, `KingdomScene`, `CareerManager.ts`, `TrainingScene`, `LeagueScene`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `Analytics.ts`, `GameScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.029) - this node is a cross-community bridge._
- **Why does `BrowserPlatformAdapter` connect `BrowserPlatformAdapter` to `TelegramPlatformAdapter`, `HapticImpactStyle`, `PlatformAdapter`, `GameScene.ts`, `BalePlatformAdapter`, `platform/src/types.ts`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `getSceneViewport`, `.openLivePvpLobby`, `upgrades.ts`, `daily.ts`, `DailyScene`, `GameScene.ts`, `KingdomScene`, `CareerManager.ts`, `TrainingScene`, `LeagueScene`, `GameScene`?**
  _High betweenness centrality (0.012) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _411 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.08563134978229318 - nodes in this community are weakly interconnected._
- **Should `bindings_main.js` be split into smaller, more focused modules?**
  _Cohesion score 0.0174931129476584 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.1354723707664884 - nodes in this community are weakly interconnected._