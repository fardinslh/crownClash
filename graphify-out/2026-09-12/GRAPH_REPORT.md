# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 133 files · ~117,596 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1462 nodes · 3757 edges · 65 communities (43 shown, 20 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `a761043c`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- GameScene.ts
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
- KingdomScene.ts
- UpgradeType
- HudLayout.ts
- NakamaClient
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
- LOGICAL_HEIGHT
- package.json
- HapticImpactStyle
- .bindLiveMatch
- daily.ts
- Crown Clash — Art Bible & Visual Direction
- main.go
- HubLayouts.ts
- LiveMatchClient.ts
- commanders.ts
- env.d.ts
- UpgradeCardMeta.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- wholeMatchSeconds
- False-Green Guard
- LiveMatchClient
- Analytics event catalog
- rules/graphify.md
- GEMINI.md
- TrainingScene

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
- `successResult()` --calls--> `createDefaultCareer()`  [EXTRACTED]
  apps/game/src/upgrades/__tests__/UpgradePurchaseController.test.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `PlayerCareer`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (65 total, 20 thin omitted)

### Community 0 - "GameScene.ts"
Cohesion: 0.06
Nodes (73): LiveMatchStarted, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction() (+65 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (73): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+65 more)

### Community 2 - "CareerManager.ts"
Cohesion: 0.18
Nodes (14): GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), isStaleSocketError(), localStorageMock, storage (+6 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (67): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield() (+59 more)

### Community 5 - "PlatformAdapter"
Cohesion: 0.07
Nodes (15): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+7 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.10
Nodes (40): getCommander(), KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomTier, KingdomTierId, MAX_KINGDOM_LEVEL, claimLeagueRewardLocally(), createLeagueState() (+32 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (60): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+52 more)

### Community 8 - "TutorialController"
Cohesion: 0.10
Nodes (13): createController(), createRecorder(), get(), mockLocalStorage(), markTutorialCompleted(), STEP_DEFINITIONS, storageKey(), TUTORIAL_STEPS (+5 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "TestGameObject"
Cohesion: 0.08
Nodes (3): { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, TestContainer, TestGameObject

### Community 11 - "types.go"
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 13 - "DailyRewardType"
Cohesion: 0.30
Nodes (4): DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "KingdomScene.ts"
Cohesion: 0.22
Nodes (16): sounds, MISSION_ICONS, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, LESSONS, TeamVisualTheme, THEME, isTutorialCompleted() (+8 more)

### Community 15 - "UpgradeType"
Cohesion: 0.08
Nodes (14): KingdomScene, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, purchaseUpgradeThroughCareer() (+6 more)

### Community 16 - "HudLayout.ts"
Cohesion: 0.16
Nodes (21): computeHudLayout(), DominanceBarLayout, DominanceCalculationInput, estimateTextWidthFallback(), fitTextToWidth(), formatCompactNumber(), formatHudCoins(), formatHudName() (+13 more)

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
Cohesion: 0.42
Nodes (3): CommanderScene, computeCommanderLayout(), getKingdomLevel()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.11
Nodes (20): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+12 more)

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
Cohesion: 0.19
Nodes (3): CareerApi, EconomyLedgerEntry, PlayerCareer

### Community 39 - "SmoothnessHelpers.ts"
Cohesion: 0.15
Nodes (11): computeMarchStride(), createStrideMetrics(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS (+3 more)

### Community 40 - "LOGICAL_HEIGHT"
Cohesion: 0.22
Nodes (6): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS, ExpandSimulationResult, LOGICAL_HEIGHT

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 44 - "daily.ts"
Cohesion: 0.23
Nodes (12): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+4 more)

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.06
Nodes (71): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Store, Team, liveArmyID(), livePlayerMatchID() (+63 more)

### Community 47 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

### Community 48 - "LiveMatchClient.ts"
Cohesion: 0.21
Nodes (10): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, LiveServerPayload, MatchSettlement, PvpAction (+2 more)

### Community 49 - "commanders.ts"
Cohesion: 0.28
Nodes (6): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, isCommanderUnlocked(), normalizeCommanderId(), createDefaultCareer()

### Community 52 - "UpgradeCardMeta.ts"
Cohesion: 0.50
Nodes (3): UPGRADE_CARD_META, UPGRADE_TYPES, UpgradeCardMeta

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 67 - "TrainingScene"
Cohesion: 0.27
Nodes (3): Lesson, TrainingScene, TutorialStepId

## Knowledge Gaps
- **254 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+249 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 420 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **20 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `GameScene.ts`, `TelegramPlatformAdapter`, `CareerManager.ts`, `TrainingScene`, `GameScene`, `PlayerCareer`, `KingdomScene.ts`, `UpgradeType`, `LiveMatchClient.ts`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `CommanderScene`, `platform/src/types.ts`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.083) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `GameScene.ts`, `CareerManager.ts`, `GameScene`, `PlatformAdapter`, `PlayerCareer`, `daily.ts`, `KingdomScene.ts`, `UpgradeType`, `LiveMatchClient.ts`, `commanders.ts`, `CommanderScene`, `DailyScene`, `LeagueScene`?**
  _High betweenness centrality (0.040) - this node is a cross-community bridge._
- **Why does `TestGameObject` connect `TestGameObject` to `HubLayouts.ts`?**
  _High betweenness centrality (0.027) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _254 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `GameScene.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.060855639441775335 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.06022282445046673 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07950310559006211 - nodes in this community are weakly interconnected._