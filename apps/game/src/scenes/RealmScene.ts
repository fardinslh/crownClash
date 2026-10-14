import { startChosenBotMatch } from '../ui/BotDifficultyPicker.js';
import { trackEvent } from '../analytics/Analytics.js';
import Phaser from 'phaser';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { CoinOrder, RealmConfig, RealmHome, RealmResult, RealmSource, RealmDefense, CommanderId, UpgradeType } from '@crown-clash/game-core';
import { purchaseUpgradeThroughCareer } from '../upgrades/UpgradePurchaseController.js';
import { CareerManager } from '../career/CareerManager.js';
import { PilotClient } from '../realm/PilotClient.js';
import { realmMarkup, escapeText, number } from '../realm/RealmView.js';
import '../realm/realm.css';

const errors: Record<string,string> = { revenge_unavailable:'مهلت یا فرصت انتقام این نبرد تمام شده است.', realm_practice_active:'تمرین ناتمام داری؛ اول همان نبرد را ادامه بده.', pvp_cannot_attack_self:'این دعوت متعلق به قلمروی خودت است.', challenge_expired:'این دعوت منقضی شده؛ از دوستت لینک تازه بگیر.', challenge_not_found:'دعوت پیدا نشد.', defense_changed:'دفاع حریف تغییر کرده؛ دوباره پیش‌نمایش را باز کن.', coin_shop_locked:'خرید بعد از سه نبرد کامل و انتخاب هدف ارتقا باز می‌شود.', payments_disabled:'پرداخت هنوز برای این حساب فعال نیست.', realm_settlement_too_early:'ثبت نتیجه زودتر از زمان نبرد ممکن نیست؛ چند لحظه دیگر تلاش کن.', challenge_link_unavailable:'لینک دعوت هنوز تنظیم نشده است.', realm_ticket_expired:'مهلت این نبرد تمام شده است.' };
export function realmErrorMessage(error: unknown): string { const message = String(error); for (const [key,value] of Object.entries(errors)) if (message.includes(key)) return value; return 'ارتباط کامل نشد. دوباره تلاش کن؛ پاداش و خرید تکراری ثبت نمی‌شود.'; }
export class RealmScene extends Phaser.Scene {
  private root?: HTMLElement;
  private dialog?: HTMLElement;
  private client!: PilotClient;
  private career!: CareerManager;
  private config!: RealmConfig;
  private home!: RealmHome;
  private platform!: PlatformAdapter;
  private busy = false;
  constructor() { super('RealmScene'); }
  create(data: { result?: RealmResult } = {}): void {
    this.busy = false;
    this.platform = this.registry.get('platform') as PlatformAdapter;
    this.client = new PilotClient(this.platform);
    this.career = CareerManager.getInstance(this.platform.getUser().id);
    this.root = document.createElement('main'); this.root.className = 'realm-shell'; this.root.dir = 'rtl';
    this.root.innerHTML = '<div class="realm-content"><p>قلمرو در حال آماده شدن…</p></div>';
    document.getElementById('game-container')!.append(this.root);
    document.getElementById('loading-shell')?.classList.add('loading-shell--hidden');
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => { this.platform.hideBackButton(); this.root?.remove(); this.dialog?.remove(); this.root = undefined; this.dialog = undefined; });
    void this.loadRealm(data.result);
  }
  private async loadRealm(result?: RealmResult): Promise<void> {
    try {
      this.config = await this.client.config();
      this.home = await this.client.home();
      await this.career.refreshRemoteCareer();
      if (!this.root) return;
      trackEvent({name:'upgrade_panel_viewed',source:'menu'});
      await this.client.goal(this.home.goal);
      this.client.event('goal_viewed', this.home.goal);
      this.render(result); this.client.event('realm_viewed');
      const challenge = this.client.challenge();
      if (challenge && !this.home.activeTicket && !this.home.activePractice) await this.previewChallenge(challenge);
      else if (challenge) this.client.clearChallenge();
    } catch (error) {
      if (!this.root) return;
      this.root.textContent = realmErrorMessage(error);
      const retry = document.createElement('button'); retry.className = 'realm-button'; retry.textContent = 'تلاش دوباره'; retry.onclick = () => void this.loadRealm(result); this.root.append(retry);
    }
  }
  private render(result?: RealmResult): void {
    if (!this.root) return;
    this.root.innerHTML = realmMarkup(this.career.getCareer(), this.home, result);
    this.root.querySelectorAll<HTMLButtonElement>('[data-action]').forEach(button => button.onclick = () => void this.run(() => this.action(button.dataset.action!)));
    this.root.querySelectorAll<HTMLButtonElement>('[data-goal]').forEach(button => button.onclick = () => void this.run(async () => { await this.client.goal(button.dataset.goal as UpgradeType); this.client.event('goal_viewed', button.dataset.goal); this.home.goal = button.dataset.goal as UpgradeType; this.render(); }));
    this.root.querySelectorAll<HTMLButtonElement>('[data-revenge]').forEach(button => button.onclick = () => void this.run(async () => {const history=this.home.history.find(h=>h.matchId===button.dataset.revenge)!;if(history.combatPolicy==='equal')this.chooseCommander('فرمانده انتقام',commanderId=>this.start('revenge',{originId:history.matchId,commanderId}));else await this.start('revenge',{originId:history.matchId});}));
  }
  private message(text: string): void { const target = this.dialog?.querySelector('.realm-message') ?? this.root?.querySelector('.realm-message'); if (target) target.textContent = text; }
  private async run(task: () => Promise<void>): Promise<void> {
    if (this.busy) return; this.busy = true;
    const buttons = this.root?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)');
    buttons?.forEach(b => b.disabled = true);
    try { await task(); } catch (error) { if (!String(error).includes('bot_difficulty_cancelled')) this.message(realmErrorMessage(error)); }
    finally { this.busy = false; buttons?.forEach(b => b.disabled = false); }
  }
  private async action(action: string): Promise<void> {
    if (action === 'attack') {
      if (this.home.activePractice) { this.scene.start('GameScene', { botMatch:this.home.activePractice, realmGoal:this.home.goal });return; }
      if (this.home.activeTicket) { this.scene.start('GameScene', { botMatch: this.home.activeTicket, realmTicket: this.home.activeTicket, realmGoal:this.home.goal }); return; }
      try { await this.start('ranked'); }
      catch (error) { if (!String(error).includes('no_realm_opponent')) throw error;
        this.openDialog('<h2>حریف نزدیک پیدا نشد</h2><p>فعلاً قلمروی بازیکن مناسبی در دسترس نیست. می‌توانی با ربات تمرین کنی؛ این نبرد جام ندارد.</p><button class="realm-primary" data-practice>تمرین با ربات</button>');
        this.dialog!.querySelector<HTMLButtonElement>('[data-practice]')!.onclick = () => void this.run(() => this.practice());
      }
    } else if (action === 'upgrade') { const r = await purchaseUpgradeThroughCareer(this.career,this.platform,this.home.goal); if (!r.success) throw new Error(r.reason); await this.loadRealm(); }
    else if (action === 'shop') await this.shop();
    else if (action === 'invite') this.chooseCommander('فرمانده دفاع دوستانه',async commanderId=>{const opened=await this.client.invite(this.config,commanderId);this.message(opened?'دعوت آماده شد؛ آن را برای دوستت بفرست.':'اشتراک‌گذاری انجام نشد؛ دوباره تلاش کن.');});
    else if (action === 'live') {
      this.openDialog('<h2>فرمانده نبرد زنده</h2><p>ارتقای سکه‌ای در نبرد زنده مزیت قدرت نمی‌دهد؛ هر سه فرمانده برای این نبرد در دسترس‌اند.</p><select><option value="crown_guard">نگهبان تاج</option><option value="quartermaster">تدارکات</option><option value="vanguard">پیشرو</option></select><button class="realm-primary" data-live>ورود به رقابت زنده</button>');
      this.dialog!.querySelector<HTMLButtonElement>('[data-live]')!.onclick=()=>void this.run(async()=>{ await this.client.request('live/loadout',{ commanderId:this.dialog!.querySelector('select')!.value });this.scene.start('MenuScene'); });
    }
    else if (action === 'practice') await this.practice();
    else if (action === 'menu') this.scene.start('MenuScene');
    else if (action === 'daily') this.scene.start('DailyScene');
    else if (action === 'commander') this.scene.start('CommanderScene');
  }
  private chooseCommander(title: string, action: (commander: CommanderId)=>Promise<void>): void {
    this.openDialog(`<h2>${escapeText(title)}</h2><p>این انتخاب فقط برای نبرد با قدرت برابر است و مالکیت دائمی فرمانده را تغییر نمی‌دهد.</p><select><option value="crown_guard">نگهبان تاج · متعادل</option><option value="quartermaster">تدارکات · تولید بیشتر، حرکت کندتر</option><option value="vanguard">پیشرو · حرکت سریع‌تر، سرباز کمتر</option></select><button class="realm-primary" data-loadout>ادامه</button>`);
    this.dialog!.querySelector<HTMLButtonElement>('[data-loadout]')!.onclick=()=>void this.run(()=>action(this.dialog!.querySelector('select')!.value as CommanderId));
  }
  private async practice(): Promise<void> { const botMatch = this.home.activePractice ?? await startChosenBotMatch(this, this.career, this.platform); this.scene.start('GameScene', { source:'menu', botMatch, realmGoal:this.home.goal }); }
  private async start(source: RealmSource, extra: { originId?: string; token?: string; defenseVersion?: string; commanderId?: CommanderId } = {}): Promise<void> {
    const ticket = await this.client.start(source, extra); this.client.clearChallenge(); this.scene.start('GameScene', { source:'menu', botMatch:ticket, realmTicket:ticket, realmGoal:this.home.goal });
  }
  private openDialog(markup: string): void {
    this.dialog?.remove(); this.dialog = document.createElement('div'); this.dialog.className='realm-dialog'; this.dialog.setAttribute('role','dialog'); this.dialog.setAttribute('aria-modal','true');
    this.dialog.innerHTML = `<section>${markup}<div class="realm-message" role="status"></div><button class="realm-button realm-close">بازگشت به قلمرو</button></section>`;
    this.root!.append(this.dialog);
    this.dialog.querySelector<HTMLButtonElement>('.realm-close')!.onclick=()=>this.closeDialog();
    this.platform.showBackButton(()=>this.closeDialog());
    this.dialog.querySelector<HTMLElement>('button,select')?.focus();
  }
  private closeDialog(): void { this.client.clearChallenge(); this.dialog?.remove(); this.dialog=undefined; this.platform.hideBackButton(); }
  private async previewChallenge(token: string): Promise<void> {
    let defense: RealmDefense;
    try { defense = await this.client.resolve(token); }
    catch(error) { this.openDialog(`<h2>دعوت به نبرد</h2><p>${escapeText(realmErrorMessage(error))}</p>`); return; }
    this.client.event('challenge_viewed',token);
    this.openDialog(`<h2>دفاع ${escapeText(defense.displayName)} را شکست بده</h2><p>این دفاع متعلق به دوست توست و نیروهایش خودکار فرمان می‌گیرند. قدرت پایه برابر است؛ ارتقاهای خریداری‌شده مزیت نمی‌دهند.</p><p>${defense.challengeRewardEligible === false ? 'این نبرد امروز پاداش ندارد؛ سهم این حریف یا سقف روزانه مصرف شده. رقابت همچنان باز است.' : 'پاداش: ۲۰ سکه، یک‌بار برای هر حریف در روز؛ تا ۳ پاداش اجتماعی در روز.'} جام تغییر نمی‌کند.</p><label>فرمانده این نبرد<select><option value="crown_guard">نگهبان تاج · متعادل</option><option value="quartermaster">تدارکات · تولید بیشتر، حرکت کندتر</option><option value="vanguard">پیشرو · حرکت سریع‌تر، سرباز کمتر</option></select></label><button class="realm-primary" data-challenge>شروع چالش</button>`);
    this.dialog!.querySelector<HTMLButtonElement>('[data-challenge]')!.onclick = () => void this.run(async () => {try {await this.start('friend',{ token, defenseVersion:defense.version, commanderId:this.dialog!.querySelector('select')!.value as CommanderId });}catch(error){if(String(error).includes('defense_changed')) {await this.previewChallenge(token);this.message(realmErrorMessage(error));}else throw error;}});
  }
  private async shop(): Promise<void> {
    const shop = await this.client.shop();
    this.openDialog(`<h2>سکه برای قدم بعدی</h2><p>سکه را با بازی هم به دست می‌آوری. خرید، راه اختیاری برای ارتقای سریع‌تر قلمرو است. چالش دوستانه قدرت برابر دارد.</p>${!shop.eligible ? '<div class="realm-notice">بعد از ۳ نبرد کامل و انتخاب هدف ارتقا، خرید باز می‌شود.</div>' : ''}${!shop.enabled ? '<div class="realm-notice">پرداخت هنوز در این محیط فعال نیست.</div>' : ''}${shop.products.map(p=>`<article class="realm-product"><strong>${number(p.coins)} سکه</strong><p>${p.once ? 'بسته شروع · یک‌بار برای هر حساب' : 'بسته سکه'} · ${number(p.amountRials/10)} تومان</p><button class="realm-button" data-product="${p.id}" ${shop.enabled&&shop.eligible?'':'disabled'}>خرید ${number(p.amountRials/10)} تومان</button></article>`).join('')}<button class="realm-button" data-pending>بررسی سفارش قبلی</button>`);
    this.dialog!.querySelectorAll<HTMLButtonElement>('[data-product]').forEach(button=>button.onclick=()=>void this.run(async()=>{
      button.disabled=true;
      try { const product=shop.products.find(p=>p.id===button.dataset.product)!;const order=await this.client.createOrder(product);if(order.state==='fulfilled'){await this.career.refreshRemoteCareer();this.message('این سفارش قبلاً ثبت شده است.');return;}await this.client.checkout(order);await this.checkOrder(); }
      finally {button.disabled=false;}
    }));
    this.dialog!.querySelector<HTMLButtonElement>('[data-pending]')!.onclick=()=>void this.run(()=>this.checkOrder());
  }
  private async checkOrder(): Promise<void> {
    const order: CoinOrder|undefined = await this.client.pendingOrder();
    if (!order) { this.message('سفارش معلقی پیدا نشد.');return; }
    if(order.state==='fulfilled'){await this.career.refreshRemoteCareer();this.closeDialog();await this.loadRealm();this.message('پرداخت تأیید شد؛ سکه به قلمرو اضافه شد.');}
    else if(order.state==='refunded') this.message('بازپرداخت این سفارش ثبت شده است.');
    else {
      this.message('سفارش محفوظ است؛ تا تأیید سرور سکه اضافه نمی‌شود.');
      if(order.invoice){const retry=document.createElement('button');retry.className='realm-button';retry.textContent='باز کردن دوباره همان پرداخت';retry.onclick=()=>void this.run(async()=>{await this.client.checkout(order);await this.checkOrder();});this.dialog?.querySelector('section')?.append(retry);}
    }
  }
}
