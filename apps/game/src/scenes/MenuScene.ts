import { preferredBotDifficulty, startChosenBotMatch } from '../ui/BotDifficultyPicker.js';
import { armLiveQueueFallback } from '../pvp/liveQueueFallback.js';
import { PilotClient } from '../realm/PilotClient.js';
import Phaser from 'phaser';
import {
  getRankTier,
  getCommander,
  LOGICAL_HEIGHT,
  LOGICAL_WIDTH,
} from '@crown-clash/game-core';
import { trackEvent } from '../analytics/Analytics.js';
import { isLocalCareerFallbackAllowed } from '../api/GameApiClient.js';
import { CareerManager } from '../career/CareerManager.js';
import { sounds } from '../audio/SoundEffects.js';
import { THEME, UI, type ButtonVariant } from '../theme.js';
import { createPlatformAdapter, isHapticsEnabled, PlatformAdapter, setHapticsEnabled } from '@crown-clash/platform';
import { LiveMatchClient } from '../api/LiveMatchClient.js';
import { LivePvpController, isValidRoomCode, sanitizeRoomCode } from '../pvp/LivePvpController.js';
import { featureFlags } from '../config/featureFlags.js';
import {
  resolveMenuEntryAction,
  resolvePlayEntryAction,
  resolvePvpEntryAction,
} from '../tutorial/TutorialStatus.js';
import { dismissStartupLoadingShell } from '../ui/StartupLoadingShell.js';
import {
  bindSceneViewportResize,
  getSceneViewport,
  setupSceneCamera,
} from '../ui/Viewport.js';
import { computeMenuLayout, MENU_NAV_TILE_HEIGHT } from '../ui/MenuLayout.js';
import { createText, MONO_FONT_FAMILY } from '../ui/TextStyles.js';
import { commanderIcon, createIcon, rankIcon, type IconKey } from '../ui/icons.js';
import {
  bindPressFeedback,
  createButton,
  createGlow,
  createIconButton,
  createRays,
  drawPanel,
  fadeIn,
  goToScene,
  type KitButton,
} from '../ui/kit/index.js';
import { createHubBackdrop, loadHubTextures } from '../ui/kit/hubBackdrop.js';
import { commanderCopy, fa, rankName } from '../i18n/fa.js';
import { prefetchLazyScenes, startScene } from './lazyScenes.js';

const prefersReducedMotion = (): boolean =>
  typeof window !== 'undefined' &&
  window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;

export class MenuScene extends Phaser.Scene {
  private liveClient?: LiveMatchClient;
  /** Disarms the 1v1 queue's bot-fallback timer; set while the lobby waits for an opponent. */
  private disarmQueueFallback?: () => void;
  /** True from the moment the queue gives up on a human until the bot match starts or fails. */
  private fallingBackToBot = false;
  private pvpController?: LivePvpController;
  private joinCodeInput?: HTMLInputElement;
  private joinCodeInputCleanup?: () => void;
  private isTransitioning = false;
  /** Bumped on create and shutdown so an async init from an earlier run can tell it is stale. */
  private initGeneration = 0;

  constructor() {
    super({ key: 'MenuScene' });
  }

  /**
   * Launches the guided training battle. The training match is fully
   * client-local (no server ticket, no settlement); completion is saved
   * account-wide by GameScene once the five guided actions are performed
   * (the finale is capturing the enemy base).
   */
  private startTrainingBattle(): void {
    if (this.isTransitioning) return;
    this.isTransitioning = true;
    this.registry.set('trainingLaunchedThisSession', true);
    sounds.playReinforce();
    this.platformHapticSelection();
    goToScene(this, 'GameScene', { source: 'menu', mode: 'bot', training: true });
  }

  private platformHapticSelection(): void {
    const platform = this.registry.get('platform') as PlatformAdapter | undefined;
    platform?.hapticSelection();
  }

  shutdown(): void {
    this.initGeneration += 1;
    this.isTransitioning = false;
    this.pvpController?.destroy();
    this.pvpController = undefined;
    this.liveClient?.close();
    this.liveClient = undefined;
    this.disarmQueueFallback?.();
    this.disarmQueueFallback = undefined;
    this.fallingBackToBot = false;
    const platform = this.registry.get('platform') as PlatformAdapter | undefined;
    platform?.hideBackButton();
    this.joinCodeInputCleanup?.();
    this.joinCodeInput = undefined;
    this.joinCodeInputCleanup = undefined;
  }

  create(): void {
    const generation = ++this.initGeneration;
    this.isTransitioning = false;
    setupSceneCamera(this);
    bindSceneViewportResize(this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => this.shutdown());

    const platform: PlatformAdapter =
      (this.registry.get('platform') as PlatformAdapter) || createPlatformAdapter();
    const careerManager = CareerManager.getInstance(platform.getUser().id);

    void this.initializeMenu(platform, careerManager, generation);
  }

  private async initializeMenu(
    platform: PlatformAdapter,
    careerManager: CareerManager,
    generation: number
  ): Promise<void> {
    // The awaits below can outlive this scene run (fast navigation, restart).
    const isStale = (): boolean => generation !== this.initGeneration;
    try {
      await careerManager.connect(platform);
    } catch (error) {
      console.warn('[MenuScene] Backend unavailable, using local career cache:', error);
    }
    if (isStale()) return;

    if (!careerManager.isRemoteConnected() && !isLocalCareerFallbackAllowed()) {
      this.showBackendUnavailable();
      return;
    }

    const career = careerManager.getCareer();
    if (careerManager.isRemoteConnected()) {
      try {
        const pilot = new PilotClient(platform);
        const config = await pilot.config();
        if (isStale()) return;
        this.registry.set('realmPilot', config.enabled);
        if (config.enabled) {
          await pilot.attachEntry();
          if (isStale()) return;
          if (careerManager.isTutorialCompleted() && pilot.challenge()) {
            const home = await pilot.home();
            if (isStale()) return;
            if (!home.activeTicket && !home.activePractice) {
              startScene(this, 'RealmScene');
              return;
            }
            pilot.clearChallenge();
          }
        }
      } catch (error) {
        // Do not mask pilot failures by entering a different economic flow.
        if (this.registry.get('realmPilot')) { this.showBackendUnavailable(); return; }
      }
    }


    // First-launch policy: an incomplete tutorial auto-starts the guided
    // training battle once per session (a skipped training returns to this
    // menu instead of bouncing straight back in; the next app launch
    // resumes the remaining guided actions).
    if (
      resolveMenuEntryAction(
        careerManager.isTutorialCompleted(),
        this.registry.get('trainingLaunchedThisSession') === true
      ) === 'auto_training'
    ) {
      this.startTrainingBattle();
      return;
    }
    const rank = getRankTier(career.trophies);

    sounds.startHubMusic();
    trackEvent({
      name: 'menu_viewed',
      rankId: rank.id,
    });

    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const layout = computeMenuLayout(visibleHeight);
    const reducedMotion = prefersReducedMotion();
    const surplus = Math.max(0, visibleHeight - LOGICAL_HEIGHT);
    const cx = LOGICAL_WIDTH / 2;
    this.add.rectangle(cx, visibleHeight / 2, visibleWidth, visibleHeight, UI.bg).setDepth(-30);
    createHubBackdrop(this, { reducedMotion });
    createGlow(this, cx, -40, visibleWidth * 1.5, 300, UI.button.primary.fill, 0.22);

    // ---------------------------------------------------------------- crest
    const crestSize = Math.round(Math.min(128, 96 + surplus * 0.2));
    createGlow(this, cx, layout.crestY, crestSize * 3.8, crestSize * 3.8, 0x1d4ed8, 0.5);
    const rays = createRays(this, cx, layout.crestY, crestSize * 2.9, 0xfde68a, 0.16);
    createGlow(this, cx, layout.crestY, crestSize * 2.1, crestSize * 2.1, THEME.gold, 0.38);
    const crestShadow = this.add.ellipse(cx, layout.crestY + crestSize * 0.58, crestSize * 0.8, crestSize * 0.16, 0x000000, 0.35);
    const crest = createIcon(this, cx, layout.crestY, 'crown', crestSize);
    // The Blender citadel and two knights replace the vector crown once they
    // load (the crown stays if the art is unavailable).
    const heroGeneration = this.initGeneration;
    loadHubTextures(
      this,
      [
        { key: 'hub_kingdom_citadel', path: 'assets/hub/kingdom_citadel.webp?v=hub-256-v1' },
        { key: 'unit_leader_player_front', path: 'assets/units/unit_leader_player_front.png?v=cartoon-meadow-v1.7' },
      ],
      () => {
        crest.setVisible(false);
        const citadelSize = Math.round(crestSize * 1.55);
        const citadel = this.add.image(cx, layout.crestY + 6, 'hub_kingdom_citadel').setDisplaySize(citadelSize, citadelSize);
        const knightY = layout.crestY + crestSize * 0.55;
        const knightLeft = this.add.image(cx - citadelSize * 0.5, knightY, 'unit_leader_player_front').setScale(0.4);
        const knightRight = this.add.image(cx + citadelSize * 0.5, knightY, 'unit_leader_player_front').setScale(0.4).setFlipX(true);
        for (const part of [citadel, knightLeft, knightRight]) part.setAlpha(0);
        this.tweens.add({ targets: [citadel, knightLeft, knightRight], alpha: 1, duration: 220 });
        if (!reducedMotion) {
          this.tweens.add({ targets: citadel, y: citadel.y - 6, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
        }
      },
      () => this.scene.isActive() && heroGeneration === this.initGeneration,
    );
    if (!reducedMotion) {
      this.tweens.add({ targets: rays, angle: 360, duration: 40000, repeat: -1 });
      this.tweens.add({ targets: crest, y: layout.crestY - 7, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
      this.tweens.add({ targets: crestShadow, scaleX: 0.86, alpha: 0.22, duration: 1800, yoyo: true, repeat: -1, ease: 'Sine.easeInOut' });
    }

    createText(this, cx, layout.titleY, fa.menu.title, {
      fontSize: '38px',
      fontStyle: '900',
      color: UI.text.primary,
      stroke: UI.text.stroke,
      strokeThickness: 7,
    }).setOrigin(0.5).setShadow(0, 4, '#000000', 0, true, true);
    createText(this, cx, layout.subtitleY, fa.menu.subtitle, {
      fontSize: `${UI.type.label}px`,
      fontStyle: '800',
      color: UI.text.gold,
      stroke: UI.text.stroke,
      strokeThickness: 3,
    }).setOrigin(0.5);

    // ------------------------------------------------------------ rank chip
    const rankChip = this.add.container(cx, layout.rankY);
    rankChip.add([
      drawPanel(this.add.graphics(), 244, 42, { fill: UI.surface.base, stroke: rank.color, strokeAlpha: 0.85, radius: 21 }),
      createIcon(this, 100, 0, rankIcon(rank.id), 30),
      createText(this, 80, 0, rankName(rank.id, rank.name), {
        fontSize: `${UI.type.label}px`, fontStyle: '800', color: UI.text.primary,
      }).setOrigin(1, 0.5),
      createIcon(this, -100, 0, 'trophy', 24),
      createText(this, -84, 1, `${career.trophies}`, {
        fontSize: `${UI.type.label}px`, fontStyle: '800', color: UI.text.gold,
      }).setOrigin(0, 0.5),
    ]);

    // ---------------------------------------------------------- stat cards
    // RTL: coins (the spendable currency) is the first card, on the right.
    const realmPilot = Boolean(this.registry.get('realmPilot'));
    const statCard = (x: number, icon: IconKey, label: string, value: string, color: string, stroke: number): Phaser.GameObjects.Container =>
      this.add.container(x, layout.statsY, [
        drawPanel(this.add.graphics(), 156, 56, { fill: UI.surface.raised, stroke, strokeAlpha: 0.7, radius: UI.radius.lg }),
        createIcon(this, 52, 0, icon, 34),
        createText(this, 28, -11, label, { fontSize: `${UI.type.caption}px`, fontStyle: '700', color: UI.text.muted }).setOrigin(1, 0.5),
        createText(this, 28, 10, value, { fontSize: '19px', fontStyle: '900', color, stroke: UI.text.stroke, strokeThickness: 3 }).setOrigin(1, 0.5),
      ]).setSize(156, 56);
    const coinCard = statCard(cx + 82, 'coin', realmPilot ? fa.menu.coinsRealm : fa.menu.coins, `${career.coins}`, UI.text.gold, 0xb45309);
    const winsCard = statCard(cx - 82, 'crown', fa.menu.wins, `${career.matchesWon}`, '#c7d2fe', 0x6366f1);
    if (realmPilot) {
      coinCard.setName('realm-entry').setInteractive({ useHandCursor: true });
      bindPressFeedback(coinCard);
      coinCard.on('pointerdown', () => {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        platform.hapticSelection();
        goToScene(this, 'RealmScene', undefined, () => { this.isTransitioning = false; });
      });
    }

    const commander = getCommander(career.selectedCommanderId);
    const doctrine = createText(this, cx - 11, layout.doctrineY, fa.menu.commanderLine(commanderCopy(commander.id, commander).name), {
      fontSize: `${UI.type.body}px`,
      fontStyle: '800',
      color: UI.text.accent,
    }).setOrigin(0.5);
    createIcon(this, doctrine.x + doctrine.width / 2 + 13, layout.doctrineY, commanderIcon(commander.id), 22);

    // --------------------------------------------------------------- play
    const playButton = createButton(this, cx, layout.playY, {
      width: 268,
      height: 62,
      label: fa.menu.play,
      icon: 'swords',
      fontSize: 24,
      variant: 'gold',
      onPress: () => {
        if (this.isTransitioning) return;
        // Ordinary bot entry routes through training first while the
        // account-wide tutorial flag is incomplete (the server rejects bot
        // tickets and matchmaker tickets on the same flag; the flag itself
        // is honest-client reported — see TutorialStatus).
        if (resolvePlayEntryAction(careerManager.isTutorialCompleted()) === 'training') {
          this.startTrainingBattle();
          return;
        }
        this.isTransitioning = true;
        this.tweens.killTweensOf(playButton.container);
        playButton.container.setScale(1).disableInteractive();
        playButton.setLabel(fa.menu.scouting);
        const startMatch = async () => {
          if (!this.registry.get('realmPilot')) return { botMatch: await startChosenBotMatch(this, careerManager, platform) };
          return new PilotClient(platform).nextMatch(() => startChosenBotMatch(this, careerManager, platform));
        };
        void startMatch().then((match) => {
          if (!this.scene.isActive()) return;
          sounds.playDispatch();
          platform.hapticImpact('medium');
          goToScene(this, 'GameScene', { source: 'menu', ...match });
        }).catch((error: unknown) => {
          const cancelled = String(error).includes('bot_difficulty_cancelled');
          if (!cancelled) console.error('[MenuScene] Match start failed:', error);
          this.isTransitioning = false;
          if (!this.scene.isActive()) return;
          playButton.setLabel(cancelled ? fa.menu.play : fa.menu.tryAgain);
          playButton.container.setInteractive({ useHandCursor: true });
          if (!cancelled) platform.hapticNotification('error');
        });
      },
    });
    if (!reducedMotion) {
      this.tweens.add({ targets: playButton.container, scale: 1.035, duration: 900, yoyo: true, repeat: -1, ease: 'Sine.easeInOut', delay: 600 });
    }

    // -------------------------------------------------------------- live
    const online = careerManager.isRemoteConnected();
    const liveButton = createButton(this, cx, layout.livePvpY, {
      width: 268,
      height: 50,
      label: online ? fa.menu.livePvp : fa.menu.livePvpOffline,
      icon: 'bolt',
      variant: 'secondary',
      onPress: () => {
        // PvP entry (the lobby gates the 1v1 queue, invites, and the 2v2
        // queue button) routes through training first while the flag is
        // incomplete — same honest-client flag the server gates on.
        if (resolvePvpEntryAction(careerManager.isTutorialCompleted()) === 'training') {
          this.startTrainingBattle();
          return;
        }
        liveButton.container.disableInteractive();
        this.openLivePvpLobby(platform, careerManager, liveButton);
      },
    });
    if (!online) liveButton.setEnabled(false);

    if (!careerManager.isTutorialCompleted()) {
      createButton(this, cx, layout.trainingY, {
        width: 268,
        height: 46,
        label: fa.menu.trainingRequired,
        icon: 'scroll',
        variant: 'gold',
        fontSize: 14,
        onPress: () => this.startTrainingBattle(),
      });
    } else if (careerManager.isRemoteConnected() || isLocalCareerFallbackAllowed()) {
      // The single-player campaign takes the slot the training prompt leaves free.
      createButton(this, cx, layout.trainingY, {
        width: 268,
        height: 46,
        label: fa.menu.levels,
        icon: 'crown',
        variant: 'secondary',
        fontSize: 15,
        onPress: () => {
          if (this.isTransitioning) return;
          this.isTransitioning = true;
          sounds.playReinforce();
          platform.hapticSelection();
          goToScene(this, 'LevelsScene', undefined, () => { this.isTransitioning = false; });
        },
      });
    }

    // ------------------------------------------------------- bottom nav
    // RTL: the first destination (daily) is the rightmost tile.
    const dailyAvailable = careerManager.isRemoteConnected() || isLocalCareerFallbackAllowed();
    const navigate = (key: string, sound: () => void): void => {
      if (this.isTransitioning) return;
      this.isTransitioning = true;
      sound();
      platform.hapticSelection();
      goToScene(this, key, undefined, () => { this.isTransitioning = false; });
    };
    const navTiles: Array<{ icon: IconKey; label: string; accent: number; enabled: boolean; onPress: () => void }> = [
      { icon: 'chest', label: dailyAvailable ? fa.menu.daily : fa.menu.offline, accent: THEME.gold, enabled: dailyAvailable, onPress: () => navigate('DailyScene', () => sounds.playReinforce()) },
      { icon: 'trophy', label: fa.menu.league, accent: 0x818cf8, enabled: true, onPress: () => navigate('LeagueScene', () => sounds.playTrophy()) },
      { icon: 'castle', label: fa.menu.kingdom, accent: THEME.gold, enabled: true, onPress: () => navigate('KingdomScene', () => sounds.playReinforce()) },
      { icon: commanderIcon(commander.id), label: fa.menu.council, accent: 0x60a5fa, enabled: true, onPress: () => navigate('CommanderScene', () => sounds.playReinforce()) },
    ];
    const tileWidth = 86;
    const tileGap = 8;
    navTiles.forEach((tile, index) => {
      const x = LOGICAL_WIDTH - 16 - tileWidth / 2 - index * (tileWidth + tileGap);
      this.createNavTile(x, layout.navigationY, tileWidth, tile);
    });

    const muteButton = createIconButton(this, 32, 32, sounds.isMuted() ? 'sound_off' : 'sound_on', () => {
      const muted = sounds.toggleMute();
      muteButton.setIcon(muted ? 'sound_off' : 'sound_on');
      platform.hapticSelection();
    });
    const hapticsButton = createIconButton(this, 84, 32, isHapticsEnabled() ? 'haptics_on' : 'haptics_off', () => {
      const enabled = !isHapticsEnabled();
      setHapticsEnabled(enabled);
      hapticsButton.setIcon(enabled ? 'haptics_on' : 'haptics_off');
      platform.hapticSelection();
    });

    this.playMenuEntrance(reducedMotion, [rankChip, coinCard, winsCard, playButton.container, liveButton.container]);
    dismissStartupLoadingShell();
    fadeIn(this);
    prefetchLazyScenes(this.scene.manager);
  }

  private createNavTile(
    x: number,
    y: number,
    width: number,
    tile: { icon: IconKey; label: string; accent: number; enabled: boolean; onPress: () => void }
  ): Phaser.GameObjects.Container {
    const height = MENU_NAV_TILE_HEIGHT;
    const container = this.add.container(x, y, [
      drawPanel(this.add.graphics(), width, height, {
        fill: UI.surface.raised,
        stroke: tile.enabled ? tile.accent : UI.border,
        strokeAlpha: tile.enabled ? 0.75 : 1,
        radius: UI.radius.lg,
      }),
      createIcon(this, 0, -9, tile.icon, 32),
      createText(this, 0, 19, tile.label, {
        fontSize: '12px',
        fontStyle: '800',
        color: tile.enabled ? UI.text.primary : UI.text.muted,
      }).setOrigin(0.5),
    ]).setSize(width, height);
    if (!tile.enabled) {
      container.setAlpha(0.55);
      return container;
    }
    container.setInteractive({ useHandCursor: true });
    bindPressFeedback(container);
    let down = false;
    container.on('pointerdown', () => { down = true; sounds.playClick(); });
    container.on('pointerout', () => { down = false; });
    container.on('pointerup', () => {
      if (!down) return;
      down = false;
      tile.onPress();
    });
    return container;
  }

  private playMenuEntrance(reducedMotion: boolean, targets: Phaser.GameObjects.Container[]): void {
    if (reducedMotion) return;
    targets.forEach((target, index) => {
      const y = target.y;
      target.setAlpha(0).setY(y + 14);
      this.tweens.add({ targets: target, alpha: 1, y, duration: 260, delay: 60 + index * 45, ease: 'Back.easeOut' });
    });
  }

  private openLivePvpLobby(
    platform: PlatformAdapter,
    careerManager: CareerManager,
    liveButton: KitButton
  ): void {
    // ------------------------------------------------------------------ setup
    const controller = new LivePvpController();
    this.pvpController?.destroy();
    this.pvpController = controller;

    // Root overlay – centred coordinate system (0,0 = screen centre)
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const overlay = this.add
      .container(LOGICAL_WIDTH / 2, visibleHeight / 2)
      .setDepth(150);

    // Dim the background; swallow all pointer events so nothing behind fires
    const backdrop = this.add
      .rectangle(0, 0, visibleWidth, visibleHeight, 0x000000, 0.78)
      .setInteractive();
    overlay.add(backdrop);

    // View containers – only one is visible at a time
    const lobbyView = this.add.container(0, 0);
    const waitingView = this.add.container(0, 0);
    const joinView = this.add.container(0, 0);
    const loadingView = this.add.container(0, 0);
    const errorView = this.add.container(0, 0);
    overlay.add([lobbyView, waitingView, joinView, loadingView, errorView]);

    const hideAll = (): void => {
      [lobbyView, waitingView, joinView, loadingView, errorView].forEach((v) =>
        v.setVisible(false)
      );
      joinInput.style.display = 'none';
    };

    // --------------------------------------------------- helpers
    const TS = (
      txt: string,
      x: number,
      y: number,
      size: string,
      color: string,
      extra: Partial<Phaser.Types.GameObjects.Text.TextStyle> = {}
    ) =>
      createText(this, x, y, txt, {
          fontSize: size,
          fontStyle: '700',
          color,
          align: 'center',
          ...extra,
        })
        .setOrigin(0.5);

    // Kit buttons emit 'press' on release; handlers below subscribe to it.
    const makeBtn = (
      x: number,
      y: number,
      w: number,
      h: number,
      variant: ButtonVariant,
      label: string,
      icon?: IconKey,
      fontSize = 14
    ): { bg: Phaser.GameObjects.Container; button: KitButton } => {
      const button: KitButton = createButton(this, x, y, {
        width: w,
        height: h,
        label,
        variant,
        icon,
        fontSize,
        onPress: () => button.container.emit('press'),
      });
      return { bg: button.container, button };
    };
    const card = (y: number, height: number, accent: number): Phaser.GameObjects.Graphics =>
      drawPanel(this.add.graphics({ x: 0, y }), 320, height, { fill: UI.surface.base, stroke: accent, strokeAlpha: 0.9, radius: 20, alpha: 0.99 });

    // --------------------------------------------------- CLOSE / BACK helper
    const closeLobby = (): void => {
      this.disarmQueueFallback?.();
      this.disarmQueueFallback = undefined;
      this.fallingBackToBot = false;
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.destroy();
      this.pvpController = undefined;
      platform.hideBackButton();
      cleanupJoinInput();
      overlay.destroy();
      liveButton.container.setInteractive({ useHandCursor: true });
      liveButton.setLabel(fa.menu.livePvp);
    };

    // ---------------------------------------------------------------- LOBBY VIEW
    // With the 2v2 flag enabled the card grows one button taller; with it
    // disabled the lobby keeps the 1v1 geometry (flag boundary).
    const show2v2Entry = featureFlags.enable2v2;
    const lobbyCardHeight = show2v2Entry ? 360 : 304;
    const lobbyCard = card(0, lobbyCardHeight, show2v2Entry ? THEME.twoVTwoAccent : 0x60a5fa);

    const lobbyTitleY = show2v2Entry ? -150 : -122;
    const lobbyIcon = createIcon(this, 0, lobbyTitleY - 4, 'swords', 34);
    const lobbyTitle = TS(fa.lobby.title, 0, lobbyTitleY + 30, '22px', UI.text.primary, { fontStyle: '900', stroke: UI.text.stroke, strokeThickness: 4 });
    const lobbySubtitle = TS(fa.lobby.subtitle, 0, lobbyTitleY + 56, '12px', UI.text.muted);

    const quickMatchY = show2v2Entry ? -54 : -26;
    const { bg: queueBg } = makeBtn(0, quickMatchY, 260, 52, 'primary', fa.lobby.quickMatch, 'bolt', 16);
    // 2v2 CASUAL entry — reachable only when the flag is on (Phase 5).
    const twoVTwoY = quickMatchY + 60;
    const twoVTwoEntry = show2v2Entry
      ? makeBtn(0, twoVTwoY, 260, 46, 'secondary', fa.lobby.twoVTwo, 'shield', 14)
      : null;
    const twoVTwoSub = show2v2Entry
      ? TS(fa.lobby.twoVTwoSub, 0, twoVTwoY + 33, '10px', '#a5b4fc')
      : null;
    const createY = show2v2Entry ? twoVTwoY + 62 : quickMatchY + 60;
    const { bg: createBg } = makeBtn(0, createY, 260, 46, 'success', fa.lobby.createBattle, 'castle', 14);
    const joinY = createY + 56;
    const { bg: joinBg } = makeBtn(0, joinY, 260, 46, 'secondary', fa.lobby.joinBattle, 'scroll', 14);

    // RTL: the modal close sits top-left (the back chevron owns top-right).
    const lobbyClose = createIconButton(this, -132, -lobbyCardHeight / 2 + 30, 'close', closeLobby, 18);

    lobbyView.add([
      lobbyCard, lobbyIcon, lobbyTitle, lobbySubtitle,
      queueBg, createBg, joinBg,
      lobbyClose.container,
      ...(twoVTwoEntry && twoVTwoSub
        ? [twoVTwoEntry.bg, twoVTwoSub]
        : []),
    ]);

    // -------------------------------------------------------- WAITING VIEW (room host)
    const waitCard = card(0, 340, 0x34d399);
    const waitTitle = TS(fa.lobby.roomCreated, 0, -140, '17px', UI.text.success, { fontStyle: '900', stroke: UI.text.stroke, strokeThickness: 3 });
    const waitSubtitle = TS(fa.lobby.shareCode, 0, -114, '12px', UI.text.muted);

    // Big mono room-code badge
    const codeBadgeBg = drawPanel(this.add.graphics({ x: 0, y: -68 }), 260, 56, { fill: 0x04140c, stroke: 0x34d399, strokeAlpha: 0.85, radius: 14, shadow: false });
    const codeText = createText(this, 0, -68, '--------', {
        fontFamily: MONO_FONT_FAMILY,
        fontSize: '28px',
        fontStyle: '700',
        color: '#86efac',
        letterSpacing: 6,
      })
      .setOrigin(0.5);

    const { bg: copyBg, button: copyButton } = makeBtn(67, 0, 120, 46, 'secondary', fa.lobby.copy, undefined, 13);
    const { bg: shareBg } = makeBtn(-67, 0, 120, 46, 'primary', fa.lobby.share, undefined, 13);

    // Pulsing waiting indicator
    const waitDot = createIcon(this, 0, 56, 'swords', 30);
    const waitStatus = TS(fa.lobby.waitingOpponent, 0, 86, '12px', UI.text.muted);
    this.tweens.add({
      targets: waitDot,
      alpha: 0.35,
      duration: 900,
      yoyo: true,
      repeat: -1,
      ease: 'Sine.easeInOut',
    });

    const { bg: leaveRoomBg } = makeBtn(0, 132, 190, 44, 'danger', fa.lobby.leaveRoom, undefined, 13);

    waitingView.add([
      waitCard, waitTitle, waitSubtitle,
      codeBadgeBg, codeText,
      copyBg, shareBg,
      waitDot, waitStatus,
      leaveRoomBg,
    ]);

    // -------------------------------------------------------- JOIN CODE VIEW
    // Position panel high (y = -120 from screen centre) so it sits above
    // the virtual keyboard (typically 280–350 px tall on mobile)
    const joinCard = card(-110, 220, 0x818cf8);
    const joinTitle = TS(fa.lobby.enterCode, 0, -196, '16px', '#c7d2fe', { fontStyle: '900', stroke: UI.text.stroke, strokeThickness: 3 });
    const joinSubtitle = TS(fa.lobby.codeHint, 0, -174, '11px', UI.text.muted);

    // Keep the keyboard input invisible. Phaser renders the visible field so
    // it always shares the modal's coordinate system on every viewport.
    const joinInput = document.createElement('input');
    joinInput.type = 'text';
    joinInput.maxLength = 8;
    joinInput.autocomplete = 'off';
    joinInput.autocapitalize = 'characters';
    joinInput.spellcheck = false;
    joinInput.inputMode = 'text';
    joinInput.setAttribute('aria-label', fa.lobby.inviteCodeLabel);
    joinInput.style.cssText = [
      'position: fixed',
      'display: none',
      'left: 0',
      'bottom: 0',
      'width: 1px',
      'height: 1px',
      'opacity: 0',
      'pointer-events: none',
      'font-size: 16px',
      'border: 0',
      'margin: 0',
      'padding: 0',
    ].join(';');
    document.body.appendChild(joinInput);

    let inputCleanedUp = false;
    const cleanupJoinInput = (): void => {
      if (inputCleanedUp) return;
      inputCleanedUp = true;
      joinInput.remove();
      if (this.joinCodeInput === joinInput) this.joinCodeInput = undefined;
      if (this.joinCodeInputCleanup === cleanupJoinInput) {
        this.joinCodeInputCleanup = undefined;
      }
    };

    this.joinCodeInput = joinInput;
    this.joinCodeInputCleanup = cleanupJoinInput;
    const joinInputBg = drawPanel(this.add.graphics({ x: 0, y: -126 }), 236, 50, { fill: 0x050913, stroke: 0x818cf8, radius: 14, shadow: false })
      .setInteractive(new Phaser.Geom.Rectangle(-118, -25, 236, 50), Phaser.Geom.Rectangle.Contains);
    const setJoinInputStroke = (color: number): void => {
      drawPanel(joinInputBg, 236, 50, { fill: 0x050913, stroke: color, radius: 14, shadow: false });
    };
    const joinInputText = createText(this, 0, -126, fa.lobby.tapToType, {
        fontSize: '12px',
        fontStyle: '700',
        color: UI.text.muted,
      })
      .setOrigin(0.5);
    const joinErrorText = TS('', 0, -89, '11px', UI.text.danger);

    const { bg: joinSubmitBg, button: joinSubmitButton } = makeBtn(55, -46, 130, 46, 'secondary', fa.lobby.join, undefined, 14);
    const { bg: joinCancelBg } = makeBtn(-77, -46, 104, 46, 'secondary', fa.lobby.cancel, undefined, 13);

    joinView.add([
      joinCard, joinTitle, joinSubtitle,
      joinInputBg, joinInputText,
      joinErrorText,
      joinSubmitBg,
      joinCancelBg,
    ]);

    // -------------------------------------------------------- LOADING VIEW
    const loadCard = card(0, 170, 0x60a5fa);
    // Spinner: one arc drawn once, rotated by a tween (no per-frame redraw).
    const loadSpinner = this.add.graphics({ x: 0, y: -34 });
    loadSpinner.lineStyle(5, UI.border, 1).strokeCircle(0, 0, 16);
    loadSpinner.lineStyle(5, 0x60a5fa, 1).beginPath().arc(0, 0, 16, 0, Math.PI * 1.2).strokePath();
    const loadText = TS(fa.lobby.connecting, 0, 10, '14px', UI.text.accent, { fontStyle: '800' });
    this.tweens.add({
      targets: loadSpinner,
      angle: 360,
      duration: 900,
      repeat: -1,
    });
    const { bg: loadCancelBg } = makeBtn(0, 54, 150, 44, 'danger', fa.lobby.cancel, undefined, 13);
    loadingView.add([loadCard, loadSpinner, loadText, loadCancelBg]);

    // -------------------------------------------------------- ERROR VIEW
    const errCard = card(0, 230, 0xf87171);
    const errIcon = createIcon(this, 0, -78, 'warning', 40);
    const errMsg = createText(this, 0, -26, '', {
        fontSize: '13px',
        fontStyle: '700',
        color: UI.text.danger,
        align: 'center',
        wordWrap: { width: 260 },
      })
      .setOrigin(0.5);
    const { bg: retryBg } = makeBtn(68, 64, 124, 46, 'primary', fa.lobby.retry, undefined, 13);
    const { bg: errBackBg } = makeBtn(-68, 64, 124, 46, 'secondary', fa.lobby.back, undefined, 13);
    errorView.add([errCard, errIcon, errMsg, retryBg, errBackBg]);

    // ------------------------------------------------ VIEW RENDERER
    let lastRetryMode: 'queue' | 'queue_2v2' | 'create' | 'join' = 'queue';
    let lastRetryCode = '';

    const showView = (view: import('../pvp/LivePvpController.js').LivePvpView, opts: {
      code?: string; error?: string; copied?: boolean;
    } = {}): void => {
      hideAll();
      switch (view) {
        case 'lobby':
          lobbyView.setVisible(true);
          platform.showBackButton(closeLobby);
          break;
        case 'creating':
        case 'joining':
        case 'queueing':
        case 'queueing_2v2': {
          loadingView.setVisible(true);
          loadText.setText(
            view === 'creating' ? fa.lobby.creatingRoom :
            view === 'joining'  ? fa.lobby.joiningRoom :
            view === 'queueing_2v2'
                                ? fa.lobby.finding2v2
            :                     fa.lobby.findingOpponent
          );
          const cancelMatchmaking = (): void => {
            this.liveClient?.close();
            this.liveClient = undefined;
            controller.cancel();
          };
          platform.showBackButton(cancelMatchmaking);
          break;
        }
        case 'waiting': {
          waitingView.setVisible(true);
          const formatted = opts.code
            ? opts.code.slice(0, 4) + '-' + opts.code.slice(4)
            : '--------';
          codeText.setText(formatted);
          if (opts.copied) {
            copyButton.setLabel(fa.lobby.copied);
            copyButton.setVariant('success');
          } else {
            copyButton.setLabel(fa.lobby.copy);
            copyButton.setVariant('secondary');
          }
          const backToLobby = (): void => controller.cancel();
          platform.showBackButton(backToLobby);
          break;
        }
        case 'entering_code': {
          joinView.setVisible(true);
          joinInput.style.display = 'block';
          joinErrorText.setText(opts.error ?? '');
          const backToLobby = (): void => controller.cancel();
          platform.showBackButton(backToLobby);
          break;
        }
        case 'error': {
          errorView.setVisible(true);
          errMsg.setText(opts.error ?? fa.lobby.connectFailed);
          const errBack = (): void => {
            this.liveClient?.close();
            this.liveClient = undefined;
            controller.returnToLobby();
          };
          platform.showBackButton(errBack);
          break;
        }
      }
    };

    // ------------------------------------------------ QUEUE -> BOT FALLBACK
    const switchToBotMatch = (waitedSeconds: number): void => {
      this.disarmQueueFallback = undefined;
      if (controller.getState().view !== 'queueing' || this.isTransitioning || this.fallingBackToBot) return;
      this.fallingBackToBot = true;
      trackEvent({ name: 'live_queue_fallback', waitedSeconds });
      loadText.setText(fa.lobby.noOpponentBot);
      this.liveClient?.close();
      this.liveClient = undefined;
      void careerManager
        .startBotMatch(platform, preferredBotDifficulty())
        .then((ticket) => {
          if (!this.scene.isActive() || !this.fallingBackToBot) return;
          this.isTransitioning = true;
          controller.destroy();
          this.pvpController = undefined;
          platform.hideBackButton();
          cleanupJoinInput();
          overlay.destroy();
          sounds.playDispatch();
          platform.hapticImpact('medium');
          goToScene(this, 'GameScene', { source: 'menu', botMatch: ticket }, () => {
            this.isTransitioning = false;
            this.fallingBackToBot = false;
          });
        })
        .catch((error: unknown) => {
          console.warn('[MenuScene] Bot fallback failed:', error);
          if (!this.scene.isActive() || !this.fallingBackToBot) return;
          this.fallingBackToBot = false;
          controller.onError('matchmaker_failed');
        });
    };

    // ------------------------------------------------ STATE SUBSCRIPTION
    controller.subscribe((state) => {
      showView(state.view, {
        code: state.roomCode,
        error: state.errorMessage,
        copied: state.copied,
      });
      // The 1v1 queue gives up on a human after a fixed wait and starts a bot
      // match instead; every other view (and leaving the queue) disarms it.
      if (state.view === 'queueing') {
        this.disarmQueueFallback ??= armLiveQueueFallback(switchToBotMatch);
      } else {
        this.disarmQueueFallback?.();
        this.disarmQueueFallback = undefined;
        // Leaving the queue (cancel, error) also cancels a bot start in flight.
        this.fallingBackToBot = false;
      }
    });

    // ------------------------------------------------ LIVE CLIENT FACTORY
    const startClient = (
      mode: 'queue' | 'queue_2v2' | 'create' | 'join',
      roomCode?: string
    ): void => {
      if (this.liveClient) return;
      lastRetryMode = mode;
      lastRetryCode = roomCode ?? '';

      let client: LiveMatchClient;
      try {
        client = careerManager.openLiveMatchRemote();
      } catch {
        controller.onError('invite_create_failed');
        return;
      }
      this.liveClient = client;

      let matchStarted = false;

      const leaveLobbyForMatch = (): void => {
        this.disarmQueueFallback?.();
        this.disarmQueueFallback = undefined;
        controller.destroy();
        this.pvpController = undefined;
        platform.hideBackButton();
        cleanupJoinInput();
        overlay.destroy();
        this.liveClient = undefined;
      };

      client.on('invite_created', ({ roomCode: createdCode }) => {
        controller.onInviteCreated(createdCode);
      });

      client.on('match_started', (match) => {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        matchStarted = true;
        trackEvent({ name: 'live_match_started', matchId: match.matchId });
        leaveLobbyForMatch();
        this.scene.start('GameScene', {
          source: 'menu',
          mode: 'live',
          liveClient: client,
          liveMatch: match,
        });
      });

      // Version-2 (2v2) transition: the v2 start payload carries slot, team
      // and roster; GameScene rebuilds its HUD and projection from it.
      client.on('match_started_2v2', (payload) => {
        if (this.isTransitioning) return;
        this.isTransitioning = true;
        matchStarted = true;
        trackEvent({ name: 'live_match_started', matchId: payload.matchId, mode: '2v2' });
        leaveLobbyForMatch();
        this.scene.start('GameScene', {
          source: 'menu',
          mode: 'live',
          liveClient: client,
          liveMatch2v2: payload,
        });
      });
      client.on('error', ({ code }) => {
        if (matchStarted || this.fallingBackToBot) return;
        controller.onError(code);
        client.close();
        this.liveClient = undefined;
      });

      client.on('closed', () => {
        if (matchStarted || this.fallingBackToBot) return;
        controller.onError('connection_closed');
        this.liveClient = undefined;
      });

      void client
        .connect(mode, roomCode)
        .then(() => {
          if (mode === 'queue') trackEvent({ name: 'live_queue_joined' });
          if (mode === 'queue_2v2') trackEvent({ name: 'live_queue_2v2_joined' });
          if (mode === 'create') trackEvent({ name: 'live_invite_created' });
          if (mode === 'join') trackEvent({ name: 'live_invite_joined' });
        })
        .catch((err: unknown) => {
          const code =
            err instanceof Error ? err.message : 'invite_create_failed';
          controller.onError(code);
          client.close();
          this.liveClient = undefined;
        });
    };

    // ------------------------------------------------ LOBBY BUTTON HANDLERS
    queueBg.on('press', () => {
      if (!controller.startQueueing()) return;
      startClient('queue');
    });

    // 2v2 CASUAL — queued through the version-2 path; the button only
    // exists when the feature flag is on, and the ticket path re-checks it.
    twoVTwoEntry?.bg.on('press', () => {
      if (!controller.startQueueing2v2()) return;
      startClient('queue_2v2');
    });

    createBg.on('press', () => {
      if (!controller.startCreating()) return;
      startClient('create');
    });

    joinBg.on('press', () => {
      const linked = new URLSearchParams(window.location.search).get('liveRoom');
      if (linked) {
        if (!controller.startJoining(linked).success) return;
        startClient('join', linked);
        return;
      }
      controller.startEnteringCode();
      window.setTimeout(() => {
        joinInput.value = '';
        joinInputText
          .setText(fa.lobby.tapToType)
          .setFontSize('12px')
          .setColor(UI.text.muted)
          .setLetterSpacing(0);
        joinInput.focus();
      }, 80);
    });

    // ------------------------------------------------ WAITING VIEW HANDLERS
    copyBg.on('press', () => {
      const state = controller.getState();
      if (!state.roomCode) return;
      const bare = state.roomCode;
      if (navigator.clipboard) {
        void navigator.clipboard.writeText(bare).then(() => {
          controller.markCopied();
          platform.hapticNotification('success');
        });
      } else {
        const ta = document.createElement('textarea');
        ta.value = bare;
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        controller.markCopied();
        platform.hapticNotification('success');
      }
    });

    shareBg.on('press', () => {
      const state = controller.getState();
      if (!state.roomCode) return;
      const code = state.roomCode;
      const url = new URL(window.location.href);
      url.searchParams.set('liveRoom', code);
      trackEvent({ name: 'share_opened', source: 'live_invite' });
      void platform.share({
        text: fa.lobby.shareText(`${code.slice(0, 4)}-${code.slice(4)}`),
        url: url.toString(),
      });
      platform.hapticSelection();
    });

    leaveRoomBg.on('press', () => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.cancel();
      platform.hapticSelection();
    });

    // ------------------------------------------------ JOIN CODE VIEW HANDLERS
    const joinInputEl = joinInput;
    joinInputBg.on('pointerdown', () => joinInputEl.focus());
    joinInputEl.addEventListener('input', () => {
      const sanitized = sanitizeRoomCode(joinInputEl.value);
      if (joinInputEl.value !== sanitized) joinInputEl.value = sanitized;
      joinInputText
        .setText(sanitized || fa.lobby.tapToType)
        .setFontSize(sanitized ? '24px' : '12px')
        .setColor(sanitized ? '#ffffff' : UI.text.muted)
        .setLetterSpacing(sanitized ? 5 : 0);
      joinErrorText.setText('');
      const valid = isValidRoomCode(sanitized);
      joinSubmitButton.setVariant(valid ? 'primary' : 'secondary');
    });
    joinInputEl.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') joinSubmitBg.emit('press');
    });
    joinInputEl.addEventListener('focus', () => {
      setJoinInputStroke(0xc7d2fe);
    });
    joinInputEl.addEventListener('blur', () => {
      setJoinInputStroke(0x818cf8);
    });

    joinSubmitBg.on('press', () => {
      const code = sanitizeRoomCode(joinInputEl.value);
      const result = controller.startJoining(code);
      if (!result.success) {
        joinErrorText.setText(result.error ?? fa.lobby.invalidCode);
        platform.hapticNotification('error');
        return;
      }
      startClient('join', code);
    });

    joinCancelBg.on('press', () => {
      controller.cancel();
      platform.hapticSelection();
    });

    // ------------------------------------------------ LOADING CANCEL
    loadCancelBg.on('press', () => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.cancel();
      platform.hapticSelection();
    });

    // ------------------------------------------------ ERROR VIEW HANDLERS
    retryBg.on('press', () => {
      if (this.liveClient) return;
      if (lastRetryMode === 'join') {
        if (!controller.startJoining(lastRetryCode).success) return;
      } else if (lastRetryMode === 'create') {
        if (!controller.startCreating()) return;
      } else if (lastRetryMode === 'queue_2v2') {
        if (!controller.startQueueing2v2()) return;
      } else {
        if (!controller.startQueueing()) return;
      }
      startClient(lastRetryMode, lastRetryCode || undefined);
      platform.hapticSelection();
    });

    errBackBg.on('press', () => {
      this.liveClient?.close();
      this.liveClient = undefined;
      controller.returnToLobby();
      platform.hapticSelection();
    });
  }

  private showBackendUnavailable(): void {
    const { visibleWidth, visibleHeight } = getSceneViewport(this);
    const cx = LOGICAL_WIDTH / 2;
    this.add.rectangle(cx, visibleHeight / 2, visibleWidth, visibleHeight, UI.bg);
    createGlow(this, cx, 210, 420, 420, 0x1d4ed8, 0.3);
    createIcon(this, cx, 200, 'crown', 84);
    createText(this, cx, 280, fa.menu.title, {
        fontSize: '32px',
        fontStyle: '900',
        color: UI.text.primary,
        stroke: UI.text.stroke,
        strokeThickness: 6,
      })
      .setOrigin(0.5);
    createText(this, cx, 336, fa.menu.connectionRequired, {
        fontSize: `${UI.type.label - 1}px`,
        fontStyle: '700',
        color: UI.text.secondary,
        align: 'center',
        wordWrap: { width: 300 },
      })
      .setOrigin(0.5);
    createButton(this, cx, 410, {
      width: 200,
      height: 52,
      label: fa.menu.retry,
      variant: 'primary',
      onPress: () => this.scene.restart(),
    });
    dismissStartupLoadingShell();
    fadeIn(this);
  }
}
