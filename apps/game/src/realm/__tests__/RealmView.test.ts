import { expect,it } from 'vitest';
import { createDefaultCareer } from '@crown-clash/game-core';
import { realmMarkup } from '../RealmView.js';
it('escapes opponent names, shows shortage and revenge without claiming live defense', () => {
 const career=createDefaultCareer('a');career.coins=0;
 const html=realmMarkup(career,{defense:{playerId:'a',displayName:'<img onerror=bad>',version:'v',kingdomLevel:0,kingdomTierId:'war_camp',trophies:0,commanderId:'crown_guard',levels:[0,0,0]},goal:'starting_garrison',socialRewardsRemaining:3,history:[{matchId:'realm_x',incoming:true,opponentName:'<script>',status:'victory',createdAt:1,revengeAvailable:true,combatPolicy:'equal'}]});
 expect(html).toContain('&lt;img onerror=bad&gt;');expect(html).not.toContain('<script>');
 expect(html).toContain('دفاع خودکار');expect(html).toContain('data-revenge="realm_x"');expect(html).toContain('سکه تا این ارتقا');
});
