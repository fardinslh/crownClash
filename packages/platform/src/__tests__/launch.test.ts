import { describe, expect, it, vi, afterEach } from 'vitest';
import { parseLaunchContext, messengerChallengeLink } from '../launch.js';
import { BalePlatformAdapter } from '../BalePlatformAdapter.js';
afterEach(() => vi.unstubAllGlobals());
describe('messenger entry and checkout', () => {
  it('reads the official Bale launch parameter and discards invalid attribution', () => {
    expect(parseLaunchContext('?tgWebAppStartParam=c_abc&campaign=ad_revenge')).toEqual({challenge:'c_abc',campaign:'ad_revenge'});
    expect(parseLaunchContext('?challenge=<script>&campaign=https://bad')).toEqual({challenge:undefined,campaign:'direct'});
    expect(messengerChallengeLink('ble.ir','CrownClashBot','c_'+'a'.repeat(32))).toBe('https://ble.ir/CrownClashBot?startapp=c_'+'a'.repeat(32));
    expect(()=>messengerChallengeLink('ble.ir','../bad','c_bad')).toThrow('challenge_link_unavailable');
  });
  it('passes the invoice verbatim and reads the object callback', async () => {
    const openInvoice = vi.fn((value: string, callback: (result: {status:string})=>void) => callback({status:'paid'}));
    vi.stubGlobal('window',{Bale:{WebApp:{openInvoice}}});
    const result = await new BalePlatformAdapter().requestPayment({slug:'opaque:invoice?x=1',title:'coin',description:'coins',amount:190000,currency:'IRR'});
    expect(openInvoice).toHaveBeenCalledWith('opaque:invoice?x=1',expect.any(Function));
    expect(result).toEqual({status:'paid'}); // This adapter result never grants currency.
  });
  it('maps the native Bale back event to the shared callback', async () => {
    const handlers = new Map<string,()=>void>();
    const show=vi.fn(),hide=vi.fn();
    vi.stubGlobal('window',{Bale:{WebApp:{onEvent:(event:string,callback:()=>void)=>handlers.set(event,callback),BackButton:{show,hide}}}});
    const adapter=new BalePlatformAdapter();await adapter.initialize();
    const callback=vi.fn();adapter.showBackButton(callback);
    expect(handlers.has('backButtonPressed')).toBe(true);
    handlers.get('backButtonPressed')!();expect(callback).toHaveBeenCalledOnce();
    adapter.hideBackButton();handlers.get('backButtonPressed')!();expect(callback).toHaveBeenCalledOnce();
    expect(show).toHaveBeenCalledOnce();expect(hide).toHaveBeenCalledOnce();
  });
  it('fails visibly without native checkout', async () => {
    vi.stubGlobal('window',{});
    const result=await new BalePlatformAdapter().requestPayment({slug:'id',title:'coins',description:'coins',amount:1,currency:'IRR'});
    expect(result.status).toBe('failed');
  });
});
