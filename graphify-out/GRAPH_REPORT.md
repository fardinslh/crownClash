# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 130 files · ~112,245 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1426 nodes · 3661 edges · 69 communities (49 shown, 19 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `f808cb09`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pvp.ts
- testing.T
- CareerManager.ts
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
- DailyRewardType
- game-core/src/index.ts
- KingdomScene
- UpgradeType
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
- game-core/src/types.ts
- PlayerCareer
- LiveMatchClient.ts
- package.json
- HapticImpactStyle
- simulation.ts
- LOGICAL_HEIGHT
- Crown Clash — Art Bible & Visual Direction
- main.go
- TrainingScene
- progression.ts
- GameScene.ts
- PlatformAdapter
- env.d.ts
- dispatch.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- UpgradePurchaseController.ts
- commanders.ts
- daily.ts
- False-Green Guard
- LiveMatchClient
- Analytics event catalog
- rules/graphify.md
- HudLayout.ts
- GEMINI.md
- HubLayouts.ts
- kingdom.ts

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 62 edges
2. `CareerManager` - 56 edges
3. `PlatformAdapter` - 56 edges
4. `getSceneViewport()` - 30 edges
5. `NewStore()` - 30 edges
6. `BrowserPlatformAdapter` - 30 edges
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

## Communities (69 total, 19 thin omitted)

### Community 0 - "pvp.ts"
Cohesion: 0.17
Nodes (17): BATTLEFIELDS, dispatchFromState(), PVP_SIMULATION_TICK_SECONDS, PVP_TIME_LIMIT_SECONDS, PvpAttackHistoryEntry, PvpAttackResult, PvpDefenseSnapshot, PvpOpponent (+9 more)

### Community 1 - "testing.T"
Cohesion: 0.07
Nodes (64): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+56 more)

### Community 2 - "CareerManager.ts"
Cohesion: 0.14
Nodes (16): GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), getSharedGameApiClient(), isStaleSocketError(), localStorageMock (+8 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (69): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield() (+61 more)

### Community 4 - "GameScene"
Cohesion: 0.08
Nodes (4): trackTerminalMatchEvent(), wholeMatchSeconds(), GameScene, getSceneViewport()

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.11
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.23
Nodes (20): formatPercent(), getArmySpeedMultiplier(), getNextUpgradeCost(), getPlayerUpgradeModifiers(), getProductionRateMultiplier(), getStartingUnits(), getTreasuryCoinBonusRate(), getUpgradeCardViewModel() (+12 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (59): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+51 more)

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
Cohesion: 0.21
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "game-core/src/index.ts"
Cohesion: 0.20
Nodes (19): sounds, platform, MISSION_ICONS, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, storage }, LESSONS, TeamVisualTheme, THEME (+11 more)

### Community 15 - "KingdomScene"
Cohesion: 0.22
Nodes (3): KingdomScene, getKingdomProgress(), KingdomProgress

### Community 16 - "UpgradeType"
Cohesion: 0.21
Nodes (5): ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, UpgradePurchaseResult, UpgradeType

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

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
Cohesion: 0.10
Nodes (18): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+10 more)

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

### Community 38 - "game-core/src/types.ts"
Cohesion: 0.19
Nodes (16): TerritoryVisual, resolveArrival(), GenerationUpdateResult, tickUnitGeneration(), BARRACKS_PRODUCTION_MULTIPLIER, FORTRESS_DEFENSE_MULTIPLIER, getRemainingDefenders(), getTerritoryDefenseMultiplier() (+8 more)

### Community 39 - "PlayerCareer"
Cohesion: 0.20
Nodes (3): CareerApi, EconomyLedgerEntry, PlayerCareer

### Community 40 - "LiveMatchClient.ts"
Cohesion: 0.21
Nodes (11): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, LiveMatchStarted, LiveServerPayload, PvpBattleSummary (+3 more)

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 43 - "simulation.ts"
Cohesion: 0.22
Nodes (13): BattlefieldDefinition, BattlefieldId, createLocalBotMatchTicket(), DEFAULT_BATTLEFIELD_ID, getBattlefield(), normalizeBattlefieldId(), createDefaultTerritories(), createInitialGameState() (+5 more)

### Community 44 - "LOGICAL_HEIGHT"
Cohesion: 0.22
Nodes (6): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS, ExpandSimulationResult, LOGICAL_HEIGHT

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.06
Nodes (79): ExtractUnverifiedUser(), extractUser(), stringifyUserID(), VerifyTelegramStyleInitData(), canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer (+71 more)

### Community 48 - "progression.ts"
Cohesion: 0.21
Nodes (14): claimLeagueRewardLocally(), createLeagueState(), getKingdomPower(), getLeagueProgress(), LEAGUE_REWARDS, LeagueProgress, calculateMatchRewards(), CurrencyType (+6 more)

### Community 49 - "GameScene.ts"
Cohesion: 0.16
Nodes (17): applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction(), stepLiveArmies() (+9 more)

### Community 52 - "dispatch.ts"
Cohesion: 0.38
Nodes (7): AiMove, evaluateAiMove(), BASE_ARMY_TRAVEL_SPEED, calculateDispatchUnits(), dispatchArmy(), dispatchMultipleArmies(), getTerritoryArmySpeedMultiplier()

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "UpgradePurchaseController.ts"
Cohesion: 0.18
Nodes (9): trackUpgradeEvent(), { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, purchaseUpgradeThroughCareer(), UpgradeCareerSource, UpgradePurchaseCallbacks, createDefaultCareer() (+1 more)

### Community 58 - "commanders.ts"
Cohesion: 0.36
Nodes (6): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId()

### Community 59 - "daily.ts"
Cohesion: 0.21
Nodes (12): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+4 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 64 - "HudLayout.ts"
Cohesion: 0.25
Nodes (9): computeHudLayout(), DominanceBarLayout, DominanceCalculationInput, DominancePercentagesResult, formatDominancePercentages(), HudElementLayout, HudLayoutResult, Rect (+1 more)

### Community 67 - "HubLayouts.ts"
Cohesion: 0.26
Nodes (10): CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout (+2 more)

### Community 68 - "kingdom.ts"
Cohesion: 0.29
Nodes (6): KINGDOM_TIERS, KINGDOM_UPGRADES, KingdomTier, KingdomTierId, MAX_KINGDOM_LEVEL, UPGRADE_DEFINITIONS

## Knowledge Gaps
- **247 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+242 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 407 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **19 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `CareerManager.ts`, `GameScene`, `.openLivePvpLobby`, `PlayerCareer`, `game-core/src/index.ts`, `KingdomScene`, `TrainingScene`, `NakamaClient`, `GameScene.ts`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `CommanderScene`, `UpgradePurchaseController.ts`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.075) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `CareerManager.ts`, `LiveMatchClient.ts`, `simulation.ts`, `CareerManager`, `game-core/src/index.ts`, `GameScene.ts`, `PlatformAdapter`, `MatchMenuController`, `LiveMatchClient`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `TestGameObject` connect `TestGameObject` to `HubLayouts.ts`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _247 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.07042253521126761 - nodes in this community are weakly interconnected._
- **Should `CareerManager.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13978494623655913 - nodes in this community are weakly interconnected._
- **Should `domain.go` be split into smaller, more focused modules?**
  _Cohesion score 0.07668231611893583 - nodes in this community are weakly interconnected._