# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 153 files · ~131,967 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1613 nodes · 4067 edges · 55 communities (40 shown, 14 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `be2aaeb8`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- BenchmarkTypes.ts
- testing.T
- commanders.ts
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
- PlatformAdapter
- GameScene.ts
- UpgradeType
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
- package.json
- HapticImpactStyle
- PerformanceMonitor
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- env.d.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- KingdomScene
- False-Green Guard
- Analytics event catalog
- rules/graphify.md
- Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist
- GEMINI.md

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 66 edges
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
- `LiveReconciliationResult` --references--> `MarchingArmy`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/types.ts
- `StressDispatchPair` --references--> `Team`  [EXTRACTED]
  apps/game/src/debug/StressModeController.ts → packages/game-core/src/types.ts
- `CommanderScene` --references--> `PlatformAdapter`  [EXTRACTED]
  apps/game/src/scenes/CommanderScene.ts → packages/platform/src/types.ts
- `DailyScene` --references--> `PlatformAdapter`  [EXTRACTED]
  apps/game/src/scenes/DailyScene.ts → packages/platform/src/types.ts

## Import Cycles
- None detected.

## Communities (55 total, 14 thin omitted)

### Community 0 - "BenchmarkTypes.ts"
Cohesion: 0.07
Nodes (37): calculateMetricDelta(), compareBenchmarks(), CompareOptions, calculatePercentiles(), computeBenchmarkMetrics(), processAndDeduplicateFrames(), RawBenchmarkSampleInput, RawFrameSample (+29 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (77): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+69 more)

### Community 2 - "commanders.ts"
Cohesion: 0.36
Nodes (6): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId()

### Community 3 - "domain.go"
Cohesion: 0.07
Nodes (69): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CommanderUnlockLevel(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState() (+61 more)

### Community 4 - "GameScene"
Cohesion: 0.05
Nodes (21): trackTerminalMatchEvent(), LiveMatchClient, LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, parseLiveErrorCode() (+13 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.08
Nodes (18): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+10 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.11
Nodes (39): KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomTier, KingdomTierId, MAX_KINGDOM_LEVEL, claimLeagueRewardLocally(), createLeagueState(), getKingdomPower() (+31 more)

### Community 7 - "context.Context"
Cohesion: 0.07
Nodes (56): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+48 more)

### Community 8 - "TutorialController"
Cohesion: 0.12
Nodes (7): createController(), createRecorder(), get(), mockLocalStorage(), TUTORIAL_STEPS, TutorialController, TutorialEvent

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
Cohesion: 0.05
Nodes (22): CareerApi, CareerManager, isStaleSocketError(), DailyClaimRunner, DailyClaimRunnerHooks, result, DailyScene, advanceDailyState() (+14 more)

### Community 14 - "GameScene.ts"
Cohesion: 0.19
Nodes (22): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, MockVector2 }, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+14 more)

### Community 15 - "UpgradeType"
Cohesion: 0.10
Nodes (18): trackUpgradeEvent(), isLocalCareerFallbackAllowed(), ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent } (+10 more)

### Community 16 - "HudLayout.ts"
Cohesion: 0.08
Nodes (32): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+24 more)

### Community 17 - "CareerManager.ts"
Cohesion: 0.13
Nodes (15): GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), NakamaClient, normalizeNakamaError(), getSharedGameApiClient(), localStorageMock (+7 more)

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
Cohesion: 0.05
Nodes (72): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies() (+64 more)

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.07
Nodes (27): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+19 more)

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

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 43 - "PerformanceMonitor"
Cohesion: 0.05
Nodes (26): DebugPerformanceHud, initDebugPerformanceIfEnabled(), BUILD_VERSION, CapturedError, ErrorSubscriber, errorSubscribers, FrameStats, getErrorSubscriberCountForTesting() (+18 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.07
Nodes (69): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Store, Team, liveArmyID(), livePlayerMatchID() (+61 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.17
Nodes (12): CommanderScene, CommanderLayout, computeCommanderLayout(), computeDailyLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X (+4 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 59 - "KingdomScene"
Cohesion: 0.18
Nodes (4): KingdomScene, computeKingdomLayout(), getKingdomProgress(), KingdomProgress

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 64 - "Crown Clash — Real-Device Gameplay & Adverse-Network QA Checklist"
Cohesion: 0.13
Nodes (14): 1. Device Matrix, 2. Preparation & Launch, 3. Real-Device QA Test Protocol, 4. Adverse Network Verification, 5. Performance Acceptance Thresholds, 6. QA Session Report Template, A. Local Network & Dev Server, B. Launch Modes & Query Parameters (+6 more)

## Knowledge Gaps
- **293 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+288 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 467 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **14 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `GameScene`, `.openLivePvpLobby`, `CareerManager`, `GameScene.ts`, `HubLayouts.ts`, `UpgradeType`, `CareerManager.ts`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `Analytics.ts`, `KingdomScene`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `CareerManager`, `PlatformAdapter`, `GameScene.ts`, `HudLayout.ts`, `CareerManager.ts`, `MatchMenuController`, `pvp.ts`?**
  _High betweenness centrality (0.047) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `GameScene`, `.openLivePvpLobby`, `GameScene.ts`, `HubLayouts.ts`, `CareerManager.ts`, `KingdomScene`, `LeagueScene`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _293 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `BenchmarkTypes.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.0726950354609929 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.05663474692202462 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.0745814307458143 - nodes in this community are weakly interconnected._