# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 130 files · ~113,978 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1440 nodes · 3702 edges · 61 communities (42 shown, 18 thin omitted)
- Extraction: 96% EXTRACTED · 4% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `3336fb82`
- Run `git rev-parse HEAD` and compare to check if the graph is stale.
- Run `graphify update .` after code changes (no API cost).

## Community Hubs (Navigation)
- pvp.ts
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
- GameScene.ts
- UpgradeType
- database/sql.DB
- NakamaClient
- AnalyticsSink
- compilerOptions
- SoundEffects
- BalePlatformAdapter
- BrowserPlatformAdapter
- MatchMenuController
- getSceneViewport
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
- .ClaimDailyReward
- live.go
- LiveMatchClient.ts
- package.json
- HapticImpactStyle
- RunMigrations
- Crown Clash — Art Bible & Visual Direction
- main.go
- TrainingScene
- env.d.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- UpgradePurchaseResult
- daily.ts
- False-Green Guard
- LiveMatchClient
- Analytics event catalog
- rules/graphify.md
- GEMINI.md
- TrainingScene.ts

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
- `LiveMatchResult` --references--> `MatchStats`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `EconomyLedgerEntry`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts
- `LiveReconciliationResult` --references--> `MarchingArmy`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/types.ts

## Import Cycles
- None detected.

## Communities (61 total, 18 thin omitted)

### Community 0 - "pvp.ts"
Cohesion: 0.05
Nodes (71): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies() (+63 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (74): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+66 more)

### Community 2 - "CareerManager.ts"
Cohesion: 0.14
Nodes (15): CareerApi, GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), normalizeNakamaError(), getSharedGameApiClient(), isStaleSocketError() (+7 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (69): TestBattlefieldLayoutsStaySymmetricAndDistinct(), applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState() (+61 more)

### Community 4 - "GameScene"
Cohesion: 0.06
Nodes (24): trackTerminalMatchEvent(), wholeMatchSeconds(), GameScene, DominanceBarLayout, DominanceCalculationInput, DominancePercentagesResult, estimateTextWidthFallback(), fitTextToWidth() (+16 more)

### Community 5 - "PlatformAdapter"
Cohesion: 0.07
Nodes (15): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+7 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.08
Nodes (50): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId(), getKingdomLevel(), getKingdomProgress() (+42 more)

### Community 7 - "context.Context"
Cohesion: 0.09
Nodes (35): CommanderUnlockLevel(), findStoredLeagueClaim(), getClaimedLeagueRanks(), getRankTierForID(), LeagueState, RankTierInfo, Store, careerFromRow() (+27 more)

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
Cohesion: 0.25
Nodes (3): isLocalCareerFallbackAllowed(), CareerManager, PlayerCareer

### Community 13 - "DailyRewardType"
Cohesion: 0.26
Nodes (4): DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "GameScene.ts"
Cohesion: 0.13
Nodes (29): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, TerritoryVisual, CardHandle, { MockScene, MockGameObject, MockGraphics, MockContainer, storage } (+21 more)

### Community 15 - "UpgradeType"
Cohesion: 0.09
Nodes (9): KingdomScene, ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, purchaseUpgradeThroughCareer(), UpgradeCareerSource, KingdomProgress, isUpgradeMilestoneLevel() (+1 more)

### Community 16 - "database/sql.DB"
Cohesion: 0.19
Nodes (17): Store, newLiveJoinCode(), newLiveMatchHandler(), beforeAuthenticateCustom(), matchmakerMatched(), rpcCreateInvite(), rpcJoinInvite(), database/sql.DB (+9 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.15
Nodes (6): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchNavigationAnalyticsEvent, MatchQuitEvent, createController()

### Community 24 - "getSceneViewport"
Cohesion: 0.44
Nodes (3): CommanderScene, computeCommanderLayout(), getSceneViewport()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.12
Nodes (17): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+9 more)

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

### Community 38 - ".ClaimDailyReward"
Cohesion: 0.17
Nodes (22): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+14 more)

### Community 39 - "live.go"
Cohesion: 0.17
Nodes (19): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Team, liveArmyID(), livePlayerMatchID(), mapTeamForRole() (+11 more)

### Community 40 - "LiveMatchClient.ts"
Cohesion: 0.25
Nodes (7): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, MatchSettlement, PvpAction

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
Cohesion: 0.17
Nodes (33): afterAuthenticateCustom(), analyticsProperties(), analyticsPropertiesWithDuration(), PvpAction, Store, identityFromUsername(), InitModule(), loadServerConfig() (+25 more)

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "UpgradePurchaseResult"
Cohesion: 0.15
Nodes (6): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, createDefaultCareer(), EconomyLedgerEntry, UpgradePurchaseResult

### Community 59 - "daily.ts"
Cohesion: 0.21
Nodes (12): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+4 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 67 - "TrainingScene.ts"
Cohesion: 0.18
Nodes (14): Lesson, LESSONS, isTutorialCompleted(), TutorialStepId, CommanderLayout, computeDailyLayout(), computeKingdomLayout(), computeLeagueLayout() (+6 more)

## Knowledge Gaps
- **252 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+247 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 412 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `TelegramPlatformAdapter`, `CareerManager.ts`, `TrainingScene.ts`, `GameScene`, `LiveMatchClient.ts`, `CareerManager`, `GameScene.ts`, `UpgradeType`, `TrainingScene`, `NakamaClient`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `platform/src/types.ts`, `getSceneViewport`, `UpgradePurchaseResult`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`?**
  _High betweenness centrality (0.079) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `pvp.ts`, `PlatformAdapter`, `LiveMatchClient.ts`, `CareerManager`, `GameScene.ts`, `MatchMenuController`, `LiveMatchClient`?**
  _High betweenness centrality (0.043) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `CareerManager.ts`, `TrainingScene.ts`, `GameScene`, `PlatformAdapter`, `LiveMatchClient.ts`, `DailyScene`, `DailyRewardType`, `GameScene.ts`, `TrainingScene`, `UpgradeType`, `getSceneViewport`, `UpgradePurchaseResult`, `daily.ts`, `LeagueScene`?**
  _High betweenness centrality (0.038) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _252 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pvp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.05158324821246169 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.05935938877461064 - nodes in this community are weakly interconnected._
- **Should `CareerManager.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.13978494623655913 - nodes in this community are weakly interconnected._