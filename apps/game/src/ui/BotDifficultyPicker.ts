import type Phaser from 'phaser';
import { BOT_DIFFICULTIES, type BotDifficulty, type BotMatchTicket } from '@crown-clash/game-core';
import type { PlatformAdapter } from '@crown-clash/platform';
import type { CareerManager } from '../career/CareerManager.js';
import './bot-difficulty.css';
import { fa } from '../i18n/fa.js';

const labels: Record<BotDifficulty, { title: string; description: string }> = {
  easy: fa.difficulty.easy,
  normal: fa.difficulty.normal,
  hard: fa.difficulty.hard,
};
const preferenceKey = 'crown-clash:bot-difficulty';
export function preferredBotDifficulty(): BotDifficulty {
  try {
    const value = localStorage.getItem(preferenceKey);
    if (BOT_DIFFICULTIES.includes(value as BotDifficulty)) return value as BotDifficulty;
  } catch { /* A preference is optional, never gameplay authority. */ }
  return 'normal';
}

/** A new match choice only; resumed tickets keep their issued difficulty. */
export function chooseBotDifficulty(scene: Phaser.Scene): Promise<BotDifficulty | null> {
  return new Promise(resolve => {
    const host = document.getElementById('game-container');
    if (!host) throw new Error('game_container_unavailable');
    const inputWasEnabled = scene.input.enabled;
    scene.input.enabled = false;
    const previousFocus = document.activeElement as HTMLElement | null;
    const root = document.createElement('div');
    root.className = 'bot-difficulty-overlay';
    root.innerHTML = `<section role="dialog" aria-modal="true" aria-labelledby="bot-difficulty-title">
      <span class="bot-difficulty-eyebrow">${fa.difficulty.eyebrow}</span><h2 id="bot-difficulty-title">${fa.difficulty.heading}</h2>
      <p>${fa.difficulty.note}</p><div class="bot-difficulty-options"></div>
      <button class="bot-difficulty-play">${fa.difficulty.play}</button><button class="bot-difficulty-cancel">${fa.difficulty.back}</button>
    </section>`;
    let selected = preferredBotDifficulty();
    const options = root.querySelector('.bot-difficulty-options')!;
    const refresh = () => root.querySelectorAll<HTMLButtonElement>('[data-difficulty]').forEach(button => {
      const active = button.dataset.difficulty === selected;
      button.setAttribute('aria-pressed', String(active));
    });
    for (const difficulty of BOT_DIFFICULTIES) {
      const button = document.createElement('button');
      button.dataset.difficulty = difficulty;
      button.innerHTML = `<strong>${labels[difficulty].title}</strong><span>${labels[difficulty].description}</span>`;
      button.onclick = () => { selected = difficulty; refresh(); };
      options.append(button);
    }
    refresh();
    let closed = false;
    const close = (value: BotDifficulty | null) => {
      if (closed) return;
      closed = true;
      scene.input.enabled = inputWasEnabled;
      scene.events.off('shutdown', shutdown);
      root.remove();
      previousFocus?.focus();
      resolve(value);
    };
    const shutdown = () => close(null);
    root.querySelector<HTMLButtonElement>('.bot-difficulty-cancel')!.onclick = () => close(null);
    root.querySelector<HTMLButtonElement>('.bot-difficulty-play')!.onclick = () => {
      try { localStorage.setItem(preferenceKey, selected); } catch { /* Optional preference. */ }
      close(selected);
    };
    root.onkeydown = event => {
      if (event.key === 'Escape') close(null);
      if (event.key === 'Tab') {
        const buttons = [...root.querySelectorAll<HTMLButtonElement>('button')];
        const index = buttons.indexOf(document.activeElement as HTMLButtonElement);
        event.preventDefault();
        buttons[(index + (event.shiftKey ? -1 : 1) + buttons.length) % buttons.length].focus();
      }
    };
    host.append(root);
    scene.events.once('shutdown', shutdown);
    root.querySelector<HTMLButtonElement>(`[data-difficulty="${selected}"]`)!.focus();
  });
}

export async function startChosenBotMatch(scene: Phaser.Scene, career: CareerManager, platform: PlatformAdapter): Promise<BotMatchTicket> {
  if (!scene.scene.isActive()) throw new Error('bot_difficulty_cancelled');
  const difficulty = await chooseBotDifficulty(scene);
  if (!difficulty || !scene.scene.isActive()) throw new Error('bot_difficulty_cancelled');
  return career.startBotMatch(platform, difficulty);
}
