import { beforeEach, afterEach, expect, it, vi } from 'vitest';
import type { PlatformAdapter } from '@crown-clash/platform';
import { PilotClient } from '../PilotClient.js';
const request=vi.hoisted(()=>vi.fn());
vi.mock('../../api/sharedClient.js',()=>({getSharedGameApiClient:()=>({pilotRequest:request})}));
const memory=new Map<string,string>();
const payment=vi.fn();
const platform={platform:'bale',getUser:()=>({id:'a'}),requestPayment:payment} as unknown as PlatformAdapter;
beforeEach(()=>{memory.clear();request.mockReset();payment.mockReset();vi.stubGlobal('localStorage',{getItem:(key:string)=>memory.get(key)??null,setItem:(key:string,value:string)=>memory.set(key,value),removeItem:(key:string)=>memory.delete(key)});});
afterEach(()=>vi.unstubAllGlobals());
it('persists order before a lost response and reuses its id on reopening',async()=>{
 const product={id:'starter' as const,coins:750,amountRials:190000,once:true};
 request.mockRejectedValueOnce(new Error('offline'));
 await expect(new PilotClient(platform).createOrder(product)).rejects.toThrow('offline');
 const first=request.mock.calls[0][1];expect(first.orderId).toBeTruthy();
 request.mockResolvedValueOnce({id:first.orderId,product,state:'pending',invoice:'opaque',createdAt:1});
 const order=await new PilotClient(platform).createOrder(product);
 expect(request.mock.calls[1][1]).toEqual(first);expect(order.invoice).toBe('opaque');
});
it('does not treat a paid SDK callback as confirmed credit',async()=>{
 payment.mockResolvedValue({status:'paid'});request.mockResolvedValue({ok:true});
 const client=new PilotClient(platform);await client.checkout({id:'order',product:{id:'refill',coins:1500,amountRials:490000,once:false},state:'pending',invoice:'unchanged',createdAt:1});
 expect(payment).toHaveBeenCalledWith(expect.objectContaining({slug:'unchanged',amount:490000}));
 expect(request.mock.calls.every(([method])=>method==='event')).toBe(true);
 expect(request.mock.calls[0][1].name).toBe('checkout_started');
});
it('keeps accounts pending orders isolated',async()=>{
 memory.set('realm:bale:a:order',JSON.stringify({orderId:'old'}));
 const other={...platform,getUser:()=>({id:'b'})} as PlatformAdapter;
 expect(await new PilotClient(other).pendingOrder()).toBeUndefined();expect(request).not.toHaveBeenCalled();
});

it('continues an active authoritative battle before creating another',async()=>{
 const ticket={matchId:'realm_active'};request.mockResolvedValueOnce({activeTicket:ticket,goal:'production'});
 const practice=vi.fn();expect(await new PilotClient(platform).nextMatch(practice)).toEqual({botMatch:ticket,realmTicket:ticket,realmGoal:'production'});
 expect(request.mock.calls.map(([method])=>method)).toEqual(['home']);expect(practice).not.toHaveBeenCalled();
});
it('starts the next public opponent and uses explicit practice only when none exists',async()=>{
 const ticket={matchId:'realm_next'};request.mockResolvedValueOnce({}).mockResolvedValueOnce(ticket);
 const practice=vi.fn().mockResolvedValue({matchId:'practice_next'});
 expect(await new PilotClient(platform).nextMatch(practice)).toEqual({botMatch:ticket,realmTicket:ticket});
 expect(request.mock.calls[1]).toEqual(['attack/start',{source:'ranked',supportedGameplayRulesVersions:[1,2,3]}]);expect(practice).not.toHaveBeenCalled();
 request.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('no_realm_opponent'));
 expect(await new PilotClient(platform).nextMatch(practice)).toEqual({botMatch:{matchId:'practice_next'}});expect(practice).toHaveBeenCalledOnce();
});
it('keeps a failed next-match request retryable instead of masking it with a bot',async()=>{
 request.mockResolvedValueOnce({}).mockRejectedValueOnce(new Error('offline'));
 const practice=vi.fn();await expect(new PilotClient(platform).nextMatch(practice)).rejects.toThrow('offline');expect(practice).not.toHaveBeenCalled();
});
