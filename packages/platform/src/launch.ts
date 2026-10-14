export interface LaunchContext { challenge?: string; campaign: string }
/** Launch data is attribution/routing only. It never grants identity or currency. */
export function parseLaunchContext(search: string, nativeStart?: string): LaunchContext {
  const params = new URLSearchParams(search);
  const start = nativeStart || params.get('startapp') || params.get('start_param') || params.get('tgWebAppStartParam') || '';
  const safe = /^[a-zA-Z0-9_-]{1,80}$/;
  const challenge = params.get('challenge') || (start.startsWith('c_') ? start : undefined);
  const campaign = params.get('campaign') || (start.startsWith('ad_') ? start : challenge ? 'friend' : 'direct');
  return { challenge: challenge && safe.test(challenge) ? challenge : undefined,
    campaign: safe.test(campaign) ? campaign : 'direct' };
}
export function browserChallengeLink(token: string): string {
  if (!/^c_[a-f0-9]{32}$/.test(token)) throw new Error('invalid_challenge');
  const url = new URL(window.location.href); url.search = ''; url.hash = '';
  url.searchParams.set('challenge', token); return url.toString();
}
export function messengerChallengeLink(host: string, bot: string, token: string): string {
  if (!/^[a-zA-Z0-9_]{5,64}$/.test(bot) || !/^c_[a-f0-9]{32}$/.test(token)) throw new Error('challenge_link_unavailable');
  return `https://${host}/${bot}?startapp=${token}`;
}
