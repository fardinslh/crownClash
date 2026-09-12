# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 132 files · ~115,387 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1457 nodes · 3736 edges · 58 communities (41 shown, 16 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `65e16a7c`
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
- GameScene.ts
- UpgradeType
- HudLayout.ts
- CareerApi
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
- PlatformAdapter
- live_pvp.smoke.mjs
- MenuLayout.ts
- package.json
- HapticImpactStyle
- Crown Clash — Art Bible & Visual Direction
- main.go
- KingdomScene
- env.d.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- False-Green Guard
- LiveMatchClient
- Analytics event catalog
- rules/graphify.md
- GEMINI.md
- HubLayouts.ts

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
- `LiveReconciliationResult` --references--> `MarchingArmy`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/types.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `deriveLiveCombatArrivals()` --calls--> `resolveArrival()`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/combat.ts
- `CommanderScene` --references--> `PlatformAdapter`  [EXTRACTED]
  apps/game/src/scenes/CommanderScene.ts → packages/platform/src/types.ts

## Import Cycles
- None detected.

## Communities (58 total, 16 thin omitted)

### Community 0 - "pvp.ts"
Cohesion: 0.06
Nodes (63): LiveMatchStarted, LiveServerPayload, AiMove, evaluateAiMove(), BattlefieldDefinition, BattlefieldId, BATTLEFIELDS, createLocalBotMatchTicket() (+55 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (73): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+65 more)

### Community 2 - "CareerManager.ts"
Cohesion: 0.14
Nodes (18): GameApiError, StaleSocketError, LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, isNakamaTransportError() (+10 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (68): TestBattlefieldLayoutsStaySymmetricAndDistinct(), applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CommanderUnlockLevel(), CreateDefaultCareer(), CreateDefaultTerritories() (+60 more)

### Community 4 - "GameScene"
Cohesion: 0.07
Nodes (11): trackTerminalMatchEvent(), applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies(), rejectLivePrediction() (+3 more)

### Community 5 - ".openLivePvpLobby"
Cohesion: 0.11
Nodes (14): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+6 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.07
Nodes (50): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked() (+42 more)

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

### Community 12 - "CareerManager"
Cohesion: 0.18
Nodes (4): isLocalCareerFallbackAllowed(), CareerManager, PlayerCareer, DailyState

### Community 13 - "DailyRewardType"
Cohesion: 0.20
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "GameScene.ts"
Cohesion: 0.18
Nodes (24): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, TerritoryVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+16 more)

### Community 15 - "UpgradeType"
Cohesion: 0.13
Nodes (12): ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, UPGRADE_CARD_META, UPGRADE_TYPES, UpgradeCardMeta, purchaseUpgradeThroughCareer(), UpgradeCareerSource (+4 more)

### Community 16 - "HudLayout.ts"
Cohesion: 0.09
Nodes (30): computeMarchStride(), DominanceBarDirtyChecker, DominanceDirtyResult, DustPuffItem, DustPuffSimulator, fastComputeDominance(), STRIDE_PERIOD_SECONDS, StrideMetrics (+22 more)

### Community 17 - "CareerApi"
Cohesion: 0.11
Nodes (8): CareerApi, TrackedAnalyticsEvent, NakamaClient, getSharedGameApiClient(), BotMatchTicket, EconomyLedgerEntry, LeagueClaimResult, LeagueState

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.10
Nodes (19): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+11 more)

### Community 27 - "DailyScene"
Cohesion: 0.14
Nodes (12): DailyScene, advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState() (+4 more)

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
Nodes (26): dependencies, @crown-clash/game-core, @crown-clash/platform, @heroiclabs/nakama-js, phaser, devDependencies, @types/node, typescript (+18 more)

### Community 37 - "generate_units.py"
Cohesion: 0.31
Nodes (10): assign_material(), build_toy_knight(), clear_mesh_objects(), get_or_create_material(), main(), Crown Clash - 2.5D Army Unit Token Generator Generates and renders stylized…, Builds a stylized 2.5D toy knight warrior figurine: - Round beveled plinth -…, render_sprite() (+2 more)

### Community 39 - "live_pvp.smoke.mjs"
Cohesion: 0.51
Nodes (9): assert(), cleanDatabaseForPlayer(), parseRpcPayload(), queryDbMatchSettlementRow(), queryPostgres(), runSmokeTest(), sleep(), verifyZeroRemainingRows() (+1 more)

### Community 40 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 46 - "main.go"
Cohesion: 0.06
Nodes (70): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Store, Team, liveArmyID(), livePlayerMatchID() (+62 more)

### Community 47 - "KingdomScene"
Cohesion: 0.19
Nodes (3): KingdomScene, computeKingdomLayout(), KingdomProgress

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 67 - "HubLayouts.ts"
Cohesion: 0.15
Nodes (11): TrainingScene, isTutorialCompleted(), CommanderLayout, computeDailyLayout(), computeLeagueLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X (+3 more)

## Knowledge Gaps
- **253 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+248 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 419 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `CareerManager.ts`, `HubLayouts.ts`, `GameScene`, `.openLivePvpLobby`, `upgrades.ts`, `CareerManager`, `GameScene.ts`, `KingdomScene`, `UpgradeType`, `CareerApi`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `CommanderScene`, `platform/src/types.ts`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.084) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `CareerManager.ts`, `GameScene`, `.openLivePvpLobby`, `PlatformAdapter`, `GameScene.ts`, `KingdomScene`, `CareerApi`, `CommanderScene`, `DailyScene`, `LeagueScene`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `TestGameObject` connect `TestGameObject` to `HubLayouts.ts`?**
  _High betweenness centrality (0.033) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _253 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pvp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.06293706293706294 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.059921710328214396 - nodes in this community are weakly interconnected._
- **Should `CareerManager.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13978494623655913 - nodes in this community are weakly interconnected._