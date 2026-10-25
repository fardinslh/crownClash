import { StaleSocketError } from '../api/GameApiClient.js';
import type { CoinOrder, CoinProduct, RealmConfig, RealmHome, RealmDefense, RealmTicket, RealmResult, RealmSource, PvpAction, CommanderId, UpgradeType, BotMatchTicket } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import { getSharedGameApiClient } from '../api/sharedClient.js';

const reconnecting = new WeakMap<object, Promise<unknown>>();

export class PilotClient {
  constructor(private readonly platform: PlatformAdapter) {}
  private key(name: string): string { return `realm:${this.platform.platform}:${this.platform.getUser().id}:${name}`; }
  private read<T>(name: string): T | undefined { try { return JSON.parse(localStorage.getItem(this.key(name)) || 'null') ?? undefined; } catch { return undefined; } }
  private save(name: string, value: unknown): void { try { localStorage.setItem(this.key(name), JSON.stringify(value)); } catch { /* Storage availability never grants rewards. */ } }
  async request<T>(method: string, payload: unknown = {}): Promise<T> {
    const api = getSharedGameApiClient();
    if (!api.pilotRequest) return Promise.reject(new Error('pilot_unavailable'));
    try { return await api.pilotRequest<T>(method, payload); }
    catch (error) {
      if (!(error instanceof StaleSocketError)) throw error;
      let login = reconnecting.get(api);
      if (!login) { login = api.login(this.platform).finally(() => reconnecting.delete(api)); reconnecting.set(api, login); }
      await login;
      return api.pilotRequest<T>(method, payload);
    }
  }
  config(): Promise<RealmConfig> { return this.request('config'); }
  home(): Promise<RealmHome> { return this.request('home', { supportedGameplayRulesVersions: [1, 2, 3, 4], supportsBotDifficulty: true }); }
  goal(goal: UpgradeType): Promise<void> { return this.request('goal', { goal }); }
  resolve(token: string): Promise<RealmDefense> { return this.request('challenge/resolve', { token }); }
  start(source: RealmSource, extra: { token?: string; originId?: string; defenseVersion?: string; commanderId?: CommanderId } = {}): Promise<RealmTicket> { return this.request('attack/start', { source, ...extra, supportedGameplayRulesVersions: [1, 2, 3, 4] }); }
  async nextMatch(startPractice: () => Promise<BotMatchTicket>): Promise<{ botMatch: BotMatchTicket | RealmTicket; realmTicket?: RealmTicket; realmGoal?: UpgradeType }> {
    const home = await this.home();
    if (home.activeTicket) return { botMatch: home.activeTicket, realmTicket: home.activeTicket, realmGoal:home.goal };
    if (home.activePractice) return { botMatch: home.activePractice, realmGoal:home.goal };
    try {
      const ticket = await this.start('ranked');
      return { botMatch: ticket, realmTicket: ticket, realmGoal:home.goal };
    } catch (error) {
      if (!String(error).includes('no_realm_opponent')) throw error;
      return { botMatch: await startPractice(), realmGoal:home.goal };
    }
  }
  settle(matchId: string, actions: readonly PvpAction[]): Promise<RealmResult> { return this.request('attack/settle', { matchId, actions }); }
  abandon(matchId: string): Promise<void> { return this.request('attack/abandon', { matchId }); }
  async invite(config: RealmConfig, commanderId: CommanderId = 'crown_guard'): Promise<boolean> {
    const { token } = await this.request<{ token: string }>('challenge/create', { commanderId });
    if (!this.platform.createChallengeLink) throw new Error('challenge_link_unavailable');
    this.event('share_prompt_viewed');
    const opened = await this.platform.share({ text: 'می‌تونی دفاع قلمروی من رو شکست بدی؟ 👑 قدرت‌ها برابرند؛ مهارتت رو نشان بده!', url: this.platform.createChallengeLink(token, config.botUsername) });
    if (opened) this.event('share_initiated', token);
    return opened;
  }
  captureEntry(): void {
    const context = this.platform.getLaunchContext?.() ?? { campaign: 'direct' };
    if (context.challenge) this.save('challenge', context.challenge);
    const entry = { visitId: crypto.randomUUID(), campaign: context.campaign, token: context.challenge ?? '' };
    this.save('entry', entry);
    const ssl = import.meta.env.VITE_NAKAMA_SSL === 'true' || (!import.meta.env.DEV && window.location.protocol === 'https:');
    const host = import.meta.env.VITE_NAKAMA_HOST || window.location.hostname;
    const port = import.meta.env.VITE_NAKAMA_PORT || '7350';
    void fetch(`${ssl ? 'https' : 'http'}://${host}:${port}/pilot/entry`, {
      method: 'POST', mode: 'no-cors', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(entry), keepalive: true,
    }).catch(() => undefined); // Authenticated association retries the same visit ID.

  }
  async attachEntry(): Promise<void> { const entry = this.read('entry'); if (entry) await this.request('entry', entry); await this.flushEvents(); }
  challenge(): string | undefined { return this.read<string>('challenge'); }
  clearChallenge(): void { this.save('challenge', null); }
  event(name: string, reference = ''): void {
    const queue = this.read<object[]>('events') ?? [];
    queue.push({ eventId: crypto.randomUUID(), name, reference }); this.save('events', queue.slice(-100));
    void this.flushEvents();
  }
  private flushing = false;
  async flushEvents(): Promise<void> {
    if (this.flushing) return; this.flushing = true;
    try {
      while (true) {
        const queue = this.read<{ eventId: string }[]>('events') ?? []; if (!queue.length) break;
        await this.request('event', queue[0]);
        this.save('events', (this.read<{ eventId: string }[]>('events') ?? []).filter(e => e.eventId !== queue[0].eventId));
      }
    } catch { /* Retained for the next authenticated session. */ } finally { this.flushing = false; }
  }
  shop(): Promise<{ enabled: boolean; eligible: boolean; products: CoinProduct[] }> { this.event('offer_viewed'); return this.request('shop'); }
  async createOrder(product: CoinProduct): Promise<CoinOrder> {
    const pending = this.read<{ orderId: string; productId: string }>('order');
    const input = pending?.productId === product.id ? pending : { orderId: crypto.randomUUID(), productId: product.id };
    this.save('order', input); // Persist before sending: lost responses reuse the same request.
    const order = await this.request<CoinOrder>('order/create', input);
    this.save('order', { orderId: order.id, productId: order.product.id }); return order;
  }
  async pendingOrder(): Promise<CoinOrder | undefined> {
    const pending = this.read<{ orderId: string; productId: string }>('order'); if (!pending) return undefined;
    let order: CoinOrder;
    try { order = await this.request<CoinOrder>('order/get', pending); }
    catch (error) { if (String(error).includes('coin_order_not_found')) return undefined; throw error; }
    if (order.state === 'fulfilled' || order.state === 'refunded') this.save('order', null);
    return order;
  }
  async checkout(order: CoinOrder): Promise<void> {
    this.event('checkout_started', order.id);
    const result = await this.platform.requestPayment({ slug: order.invoice, title: 'سکه قلمرو', description: 'ارتقای قلمرو', amount: order.product.amountRials, currency: 'IRR' });
    if (result.status === 'failed' || result.status === 'cancelled') this.event(`checkout_${result.status}`, order.id);
    // SDK callbacks are observations only. order/get is the authority for credit.
  }
  saveBattle(matchId: string, snapshot: unknown): void { this.save('battle', { matchId, snapshot }); }
  readBattle<T>(matchId: string): T | undefined { const stored=this.read<{matchId:string;snapshot:T}>('battle');return stored?.matchId===matchId ? stored.snapshot : undefined; }
  clearBattle(_matchId: string): void { try { localStorage.removeItem(this.key('battle')); } catch { /* optional cache */ } }
}
