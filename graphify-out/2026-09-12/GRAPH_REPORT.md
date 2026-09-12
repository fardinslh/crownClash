# Graph Report - crownClash  (2026-09-12)

## Corpus Check
- 128 files · ~106,669 words
- Verdict: corpus is large enough that graph structure adds value.

## Summary
- 1388 nodes · 3559 edges · 68 communities (49 shown, 18 thin omitted)
- Extraction: 95% EXTRACTED · 5% INFERRED · 0% AMBIGUOUS · INFERRED: 164 edges (avg confidence: 0.84)
- Token cost: 0 input · 0 output

## Graph Freshness
- Built from commit: `74cf2a35`
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
- store.go
- TutorialController
- GAME DEVELOPMENT AGENT CONSTITUTION
- context.Context
- types.go
- CareerManager
- DailyRewardType
- GameScene.ts
- KingdomScene
- UpgradeType
- .ClaimDailyReward
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
- game-core/src/types.ts
- PlayerCareer
- LiveMatchClient.ts
- package.json
- HapticImpactStyle
- live_pvp.smoke.mjs
- MenuLayout.ts
- Crown Clash — Art Bible & Visual Direction
- main.go
- TrainingScene
- live.go
- LiveCombatFeedback.ts
- Store
- env.d.ts
- UpgradePurchaseController.test.ts
- graphify.js
- setup_scene.py
- github.com/fardinslh/crownclash/server-nakama
- Verification Before Completion
- KingdomScene.ts
- wholeMatchSeconds
- CareerManager.ts
- False-Green Guard
- LiveMatchClient
- Analytics event catalog
- rules/graphify.md
- HudLayout.ts
- GEMINI.md
- HubLayouts.ts

## God Nodes (most connected - your core abstractions)
1. `GameScene` - 62 edges
2. `CareerManager` - 55 edges
3. `PlatformAdapter` - 55 edges
4. `getSceneViewport()` - 30 edges
5. `NewStore()` - 30 edges
6. `InitModule()` - 28 edges
7. `BalePlatformAdapter` - 28 edges
8. `BrowserPlatformAdapter` - 28 edges
9. `EitaaPlatformAdapter` - 28 edges
10. `TelegramPlatformAdapter` - 28 edges

## Surprising Connections (you probably didn't know these)
- `LiveReconciliationResult` --references--> `MarchingArmy`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/types.ts
- `LiveServerPayload` --references--> `GameState`  [EXTRACTED]
  apps/game/src/api/LiveMatchClient.ts → packages/game-core/src/types.ts
- `CareerManager` --references--> `PlayerCareer`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/progression.ts
- `CareerManager` --references--> `DailyState`  [EXTRACTED]
  apps/game/src/career/CareerManager.ts → packages/game-core/src/types.ts
- `deriveLiveCombatArrivals()` --calls--> `resolveArrival()`  [EXTRACTED]
  apps/game/src/combat/LiveCombatFeedback.ts → packages/game-core/src/combat.ts

## Import Cycles
- None detected.

## Communities (68 total, 18 thin omitted)

### Community 0 - "pvp.ts"
Cohesion: 0.10
Nodes (31): BattlefieldDefinition, BattlefieldId, BATTLEFIELDS, createLocalBotMatchTicket(), DEFAULT_BATTLEFIELD_ID, getBattlefield(), normalizeBattlefieldId(), createDefaultTerritories() (+23 more)

### Community 1 - "testing.T"
Cohesion: 0.06
Nodes (73): analyticsPayload(), analyticsPropsJSON(), analyticsTestEvent(), TestAnalyticsPayloadAcceptsCommanderEvents(), TestAnalyticsPayloadAcceptsDailyEvents(), TestAnalyticsPayloadAcceptsLeagueEvents(), TestAnalyticsPayloadAcceptsTutorialEvents(), TestAnalyticsPayloadAcceptsUpgradePanelViewedWithLegacyAndSourcedProps() (+65 more)

### Community 2 - "GameApiClient.ts"
Cohesion: 0.13
Nodes (12): GameApiError, StaleSocketError, TrackedAnalyticsEvent, isNakamaTransportError(), NakamaClient, normalizeNakamaError(), getSharedGameApiClient(), BotMatchTicket (+4 more)

### Community 3 - "domain.go"
Cohesion: 0.08
Nodes (68): applyTerritoryLayout(), BuildLeagueState(), calculateDispatchUnits(), CalculateMatchRewards(), CreateDefaultCareer(), CreateDefaultTerritories(), CreateInitialGameState(), CreateInitialGameStateForBattlefield() (+60 more)

### Community 5 - "PlatformAdapter"
Cohesion: 0.07
Nodes (15): isValidRoomCode(), LivePvpController, LivePvpListener, LivePvpState, LivePvpView, mapLivePvpError(), sanitizeRoomCode(), MenuScene (+7 more)

### Community 6 - "upgrades.ts"
Cohesion: 0.09
Nodes (45): CommanderDefinition, COMMANDERS, DEFAULT_COMMANDER_ID, getCommander(), isCommanderUnlocked(), normalizeCommanderId(), KINGDOM_TIERS, KINGDOM_UPGRADES (+37 more)

### Community 7 - "store.go"
Cohesion: 0.12
Nodes (26): findStoredLeagueClaim(), getClaimedLeagueRanks(), getRankTierForID(), LeagueState, RankTierInfo, Store, careerFromRow(), findStoredSettlement() (+18 more)

### Community 8 - "TutorialController"
Cohesion: 0.10
Nodes (14): createController(), createRecorder(), get(), mockLocalStorage(), isTutorialCompleted(), markTutorialCompleted(), STEP_DEFINITIONS, storageKey() (+6 more)

### Community 9 - "GAME DEVELOPMENT AGENT CONSTITUTION"
Cohesion: 0.08
Nodes (23): ANALYTICS, BLENDER PIPELINE, CODE QUALITY, DATABASE, DECISION RULE, DEFINITION OF DONE, DEVELOPMENT PRIORITY, ECONOMY (+15 more)

### Community 10 - "context.Context"
Cohesion: 0.20
Nodes (19): Store, newLiveJoinCode(), newLiveMatchHandler(), beforeAuthenticateCustom(), matchmakerMatched(), rpcCreateInvite(), rpcJoinInvite(), RunMigrations() (+11 more)

### Community 11 - "types.go"
Cohesion: 0.13
Nodes (30): BotMatchTicket, CommanderSelectionResult, DailyChestState, DailyClaimResult, DailyMissionState, DailyRewardType, DailyState, EconomyLedgerEntry (+22 more)

### Community 12 - "CareerManager"
Cohesion: 0.21
Nodes (3): isLocalCareerFallbackAllowed(), CareerManager, EconomyLedgerEntry

### Community 13 - "DailyRewardType"
Cohesion: 0.21
Nodes (5): DailyClaimRunner, DailyClaimRunnerHooks, result, DailyClaimResult, DailyRewardType

### Community 14 - "GameScene.ts"
Cohesion: 0.21
Nodes (18): sounds, platform, MISSION_ICONS, ArmyFollower, ArmyVisual, TerritoryVisual, LESSONS, TeamVisualTheme (+10 more)

### Community 15 - "KingdomScene"
Cohesion: 0.19
Nodes (4): KingdomScene, playUpgradeMilestoneCelebration(), getKingdomProgress(), KingdomProgress

### Community 16 - "UpgradeType"
Cohesion: 0.19
Nodes (5): ScenePurchaseRunner, ScenePurchaseRunnerHooks, fakeResult, UpgradePurchaseResult, UpgradeType

### Community 17 - ".ClaimDailyReward"
Cohesion: 0.15
Nodes (24): applyClaimToDailyRow(), buildDailyState(), dailyRewardAvailable(), dailyWindow(), ensureDailyProgress(), findStoredDailyClaim(), getDailyProgress(), MatchStats (+16 more)

### Community 18 - "AnalyticsSink"
Cohesion: 0.14
Nodes (9): AnalyticsEvent, isAnalyticsEvent(), isPrimitive(), ANALYTICS_BATCH_MAX_SIZE, AnalyticsSink, AnalyticsSinkOptions, documentListeners, listeners (+1 more)

### Community 19 - "compilerOptions"
Cohesion: 0.10
Nodes (20): compilerOptions, allowImportingTsExtensions, baseUrl, isolatedModules, lib, module, moduleResolution, noEmit (+12 more)

### Community 23 - "MatchMenuController"
Cohesion: 0.16
Nodes (5): MatchMenuController, MatchMenuDependencies, MatchMenuState, MatchQuitEvent, createController()

### Community 24 - "getSceneViewport"
Cohesion: 0.40
Nodes (4): CommanderScene, computeCommanderLayout(), getSceneViewport(), getKingdomLevel()

### Community 25 - "platform/src/types.ts"
Cohesion: 0.21
Nodes (8): Window, Window, Window, PaymentInvoice, PaymentResult, PlatformTheme, PlatformType, ShareOptions

### Community 26 - "Analytics.ts"
Cohesion: 0.12
Nodes (16): ANALYTICS_EVENT_NAME_MAX_LENGTH, ANALYTICS_PROPERTY_KEY_MAX_LENGTH, ANALYTICS_PROPERTY_MAX_COUNT, ANALYTICS_PROPERTY_STRING_MAX_LENGTH, ANALYTICS_SCHEMA_VERSION, AnalyticsEventInput, AnalyticsPrimitive, createIdentifier() (+8 more)

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

### Community 38 - "game-core/src/types.ts"
Cohesion: 0.12
Nodes (28): AiMove, evaluateAiMove(), resolveArrival(), BASE_ARMY_TRAVEL_SPEED, calculateDispatchUnits(), dispatchArmy(), dispatchMultipleArmies(), DispatchResult (+20 more)

### Community 40 - "LiveMatchClient.ts"
Cohesion: 0.17
Nodes (12): LiveMatchError, LiveMatchEvent, LiveMatchEventMap, LiveMatchMode, LiveMatchResult, isStaleSocketError(), localStorageMock, storage (+4 more)

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

### Community 46 - "main.go"
Cohesion: 0.16
Nodes (34): afterAuthenticateCustom(), analyticsProperties(), analyticsPropertiesWithDuration(), PvpAction, Store, identityFromUsername(), InitModule(), loadServerConfig() (+26 more)

### Community 47 - "TrainingScene"
Cohesion: 0.28
Nodes (3): Lesson, TrainingScene, TutorialStepId

### Community 48 - "live.go"
Cohesion: 0.16
Nodes (19): canonicalForfeitStatus(), GameState, MatchStats, PlayerCareer, Team, liveArmyID(), livePlayerMatchID(), mapTeamForRole() (+11 more)

### Community 49 - "LiveCombatFeedback.ts"
Cohesion: 0.18
Nodes (14): LiveMatchStarted, LiveServerPayload, applyPendingLiveDispatches(), armyVisualId(), deriveLiveCombatArrivals(), LiveReconciliationResult, PendingLiveDispatch, reconcileLiveArmies() (+6 more)

### Community 50 - "Store"
Cohesion: 0.11
Nodes (9): CommanderUnlockLevel(), Store, BotMatchTicket, CommanderSelectionResult, EconomyLedgerEntry, PvpAttackHistoryEntry, PvpDefenseSnapshot, PvpOpponent (+1 more)

### Community 52 - "UpgradePurchaseController.test.ts"
Cohesion: 0.40
Nodes (4): { isLocalCareerFallbackAllowed }, successResult(), { trackUpgradeEvent }, createDefaultCareer()

### Community 56 - "Verification Before Completion"
Cohesion: 0.20
Nodes (9): Common Failures, Key Patterns, Overview, Rationalization Prevention, Red Flags - STOP, The Gate Function, The Iron Law, Verification Before Completion (+1 more)

### Community 57 - "KingdomScene.ts"
Cohesion: 0.20
Nodes (9): trackUpgradeEvent(), CardHandle, UPGRADE_CARD_META, UPGRADE_TYPES, UpgradeCardMeta, purchaseUpgradeThroughCareer(), UpgradeCareerSource, UpgradePurchaseCallbacks (+1 more)

### Community 59 - "CareerManager.ts"
Cohesion: 0.24
Nodes (11): advanceDailyState(), claimDailyRewardLocally(), createDailyState(), DailyClaimFailureReason, formatDailyReset(), MISSION_DEFINITIONS, normalizeDailyState(), tehranDayFormatter (+3 more)

### Community 60 - "False-Green Guard"
Cohesion: 0.40
Nodes (4): Build the proof, Completion gate, False-Green Guard, Prove test sensitivity

### Community 64 - "HudLayout.ts"
Cohesion: 0.25
Nodes (9): computeHudLayout(), DominanceBarLayout, DominanceCalculationInput, DominancePercentagesResult, formatDominancePercentages(), HudElementLayout, HudLayoutResult, Rect (+1 more)

### Community 67 - "HubLayouts.ts"
Cohesion: 0.24
Nodes (8): CommanderLayout, computeKingdomLayout(), computeTrainingLayout(), DailyLayout, KINGDOM_COL_X, KingdomLayout, LeagueLayout, TrainingLayout

## Knowledge Gaps
- **246 isolated node(s):** `name`, `version`, `private`, `type`, `dev` (+241 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 385 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **18 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `PlatformAdapter` connect `PlatformAdapter` to `GameApiClient.ts`, `GameScene`, `CareerManager`, `GameScene.ts`, `KingdomScene`, `BalePlatformAdapter`, `BrowserPlatformAdapter`, `getSceneViewport`, `platform/src/types.ts`, `DailyScene`, `LeagueScene`, `EitaaPlatformAdapter`, `TelegramPlatformAdapter`, `PlayerCareer`, `LiveMatchClient.ts`, `TrainingScene`, `UpgradePurchaseController.test.ts`, `KingdomScene.ts`, `CareerManager.ts`?**
  _High betweenness centrality (0.067) - this node is a cross-community bridge._
- **Why does `CareerManager` connect `CareerManager` to `GameScene`, `PlatformAdapter`, `PlayerCareer`, `LiveMatchClient.ts`, `DailyScene`, `GameScene.ts`, `KingdomScene`, `getSceneViewport`, `KingdomScene.ts`, `CareerManager.ts`, `LeagueScene`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **Why does `GameScene` connect `GameScene` to `pvp.ts`, `PlatformAdapter`, `game-core/src/types.ts`, `LiveMatchClient.ts`, `CareerManager`, `GameScene.ts`, `LiveCombatFeedback.ts`, `MatchMenuController`, `LiveMatchClient`?**
  _High betweenness centrality (0.036) - this node is a cross-community bridge._
- **What connects `name`, `version`, `private` to the rest of the system?**
  _246 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `pvp.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.10128205128205128 - nodes in this community are weakly interconnected._
- **Should `testing.T` be split into smaller, more focused modules?**
  _Cohesion score 0.06022282445046673 - nodes in this community are weakly interconnected._
- **Should `GameApiClient.ts` be split into smaller, more focused modules?**
  _Cohesion score 0.12878787878787878 - nodes in this community are weakly interconnected._