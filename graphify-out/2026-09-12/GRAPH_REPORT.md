# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 125 files · ~103,524 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1371 nodes · 3483 edges · 58 communities (41 shown, 16 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `2f6bd649`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pvp.ts
- testing.T
- GameApiClient.ts
- domain.go
- GameScene
- PlatformAdapter
- upgrades.ts
- context.Context
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- main.go
- types.go
- CareerManager
- DailyRewardType
- GameScene.ts
- KingdomScene
- UpgradeType
- CareerManager.ts
- AnalyticsSink
- compilerOptions
- SoundEffects
- BalePlatformAdapter
- BrowserPlatformAdapter
- MatchMenuController
- CommanderScene.ts
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
- KingdomScene.ts
- PlayerCareer
- LiveMatchClient.ts
- package.json
- HapticImpactStyle
- live_pvp.smoke.mjs
- MenuLayout.ts
- Crown Clash — Art Bible & Visual Direction
- TrainingScene
- env.d.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- HudLayout.ts
- False-Green Guard
- Analytics event catalog
- rules/graphify.md
- GEMINI.md

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 60 edges
2. `CareerManager` - 55 edges
3. `PlatformAdapter` - 55 edges
4. `NewStore()` - 30 edges
5. `InitModule()` - 28 edges
6. `BalePlatformAdapter` - 28 edges
7. `BrowserPlatformAdapter` - 28 edges
8. `EitaaPlatformAdapter` - 28 edges
9. `TelegramPlatformAdapter` - 28 edges
10. `UpgradeType` - 27 edges

## Surprising Connections (you probably didn't know these)
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `PlayerCareer`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts
- `LiveReconciliationResult` --references--> `MarchingArmy`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (58 total, 16 thin omitted)

### Community 0 - "pvp.ts"
Cohesion: 0.05
Nodes (72): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies() (+64 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (75): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+67 more)

### Community 2 - "GameApiClient.ts"
Cohesion: 0.12
Nodes (12): GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), NakamaClient, normalizeNakamaError(), getSharedGameApiClient(), BotMatchTicket (+4 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (67): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield() (+59 more)

### Community 4 - "GameScene"
Cohesion: 0.06
Nodes (5): trackTerminalMatchEvent(), LiveMatchClient, parseLiveErrorCode(), wholeMatchSeconds(), GameScene

### Community 5 - "PlatformAdapter"
Cohesion: 0.07
Nodes (15): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+7 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.08
Nodes (47): CommanderScene, CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId(), getKingdomLevel() (+39 more)

### Community 7 - "context.Context"
Cohesion: 0.06
Nodes (61): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+53 more)

### Community 8 - "TutorialController"
Cohesion: 0.10
Nodes (13): createController(), createRecorder(), get(), mockLocalStorage(), markTutorialCompleted(), STEP_DEFINITIONS, storageKey(), TUTORIAL_STEPS (+5 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "main.go"
Cohesion: 0.07
Nodes (68): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Store, Team, liveArmyID(), livePlayerMatchID() (+60 more)

### Community 11 - "types.go"
Cohesion: 0.12
Nodes (31): AnalyticsInsertResult, BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState (+23 more)

### Community 13 - "DailyRewardType"
Cohesion: 0.21
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "GameScene.ts"
Cohesion: 0.16
Nodes (21): trackSessionStart(), sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, TerritoryVisual, Lesson (+13 more)

### Community 15 - "KingdomScene"
Cohesion: 0.21
Nodes (4): trackUpgradeEvent(), KingdomScene, getKingdomProgress(), KingdomProgress

### Community 16 - "UpgradeType"
Cohesion: 0.11
Nodes (13): ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, purchaseUpgradeThroughCareer(), UpgradeCareerSource (+5 more)

### Community 17 - "CareerManager.ts"
Cohesion: 0.24
Nodes (11): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+3 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (5): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchQuitEvent, createController()

### Community 24 - "CommanderScene.ts"
Cohesion: 0.51
Nodes (4): trackEvent(), bindSceneViewportResize(), setupSceneCamera(), createPlatformAdapter()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.12
Nodes (14): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+6 more)

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

### Community 38 - "KingdomScene.ts"
Cohesion: 0.28
Nodes (7): CardHandle, COL_X, GRID_POSITIONS, ROW_Y, UPGRADE_CARD_META, UPGRADE_TYPES, UpgradeCardMeta

### Community 39 - "PlayerCareer"
Cohesion: 0.23
Nodes (3): CareerApi, EconomyLedgerEntry, PlayerCareer

### Community 40 - "LiveMatchClient.ts"
Cohesion: 0.16
Nodes (13): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, isStaleSocketError(), localStorageMock, storage (+5 more)

### Community 41 - "package.json"
Cohesion: 0.12
Nodes (16): description, devDependencies, typescript, typescript, name, private, scripts, build (+8 more)

### Community 42 - "HapticImpactStyle"
Cohesion: 0.15
Nodes (3): fallbackPlatform, HapticImpactStyle, HapticNotificationType

### Community 43 - "live_pvp.smoke.mjs"
Cohesion: 0.51
Nodes (9): assert(), cleanDatabaseForPlayer(), parseRpcPayload(), queryDbMatchSettlementRow(), queryPostgres(), runSmokeTest(), sleep(), verifyZeroRemainingRows() (+1 more)

### Community 44 - "MenuLayout.ts"
Cohesion: 0.40
Nodes (4): BASE_LAYOUT, computeMenuLayout(), MenuLayout, SURPLUS_WEIGHTS

### Community 45 - "Crown Clash — Art Bible & Visual Direction"
Cohesion: 0.12
Nodes (15): 1. Visual Pillars, 2. Camera & Projection Standards, 3. Lighting Rig & World Setup, 4. Color Palette & Team Theming, 5. Territory Tier Proportions & Silhouettes, 6. Materials & Shading Rules, 7. VFX & Feedback Language, 8. Asset Master & Export Specifications (+7 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "HudLayout.ts"
Cohesion: 0.36
Nodes (6): computeHudLayout(), DominanceBarLayout, HudElementLayout, HudLayoutResult, Rect, rectanglesIntersect()

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

## Knowledge Gaps
- **242 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+237 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 381 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **16 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `GameApiClient.ts`, `GameScene`, `upgrades.ts`, `CareerManager`, `GameScene.ts`, `KingdomScene`, `UpgradeType`, `CareerManager.ts`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `CommanderScene.ts`, `platform/src/types.ts`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`, `TelegramPlatformAdapter`, `KingdomScene.ts`, `PlayerCareer`, `LiveMatchClient.ts`, `TrainingScene`?**
  _High betweenness centrality (0.077) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `pvp.ts`, `PlatformAdapter`, `LiveMatchClient.ts`, `CareerManager`, `GameScene.ts`, `MatchMenuController`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `GameScene`, `PlatformAdapter`, `upgrades.ts`, `PlayerCareer`, `LiveMatchClient.ts`, `KingdomScene.ts`, `GameScene.ts`, `KingdomScene`, `CareerManager.ts`, `CommanderScene.ts`, `DailyScene`, `LeagueScene`?**
  _High betweenness centrality (0.035) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _242 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pvp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05268414481897628 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.05823293172690763 - nodes in this community are weakly interconnected._
- **Should `GameApiClient.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.11942959001782531 - nodes in this community are weakly interconnected._