import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

assert.ok(process.env.TEST_POSTGRES_DSN, 'real PostgreSQL is required for the settlement control');
const controls = [
  { file:'apps/game/src/scenes/GameScene.ts', from:'chooseBotDifficulty(this).then', to:"Promise.resolve('normal' as const).then", command:'npm', args:['--workspace=apps/game','test','--','src/scenes/__tests__/GameSceneInitializationParity.test.ts','-t','first bot match waits'], expected:'first bot match waits for a difficulty choice' },
  { file:'packages/game-core/src/bot-difficulty.ts', from:"case 'easy': return 3.6;", to:"case 'easy': return 1.8;", command:'npm', args:['--workspace=packages/game-core','test','--','src/__tests__/bot-difficulty.test.ts'], expected:'changes reaction time' },
  { file:'apps/game/src/api/NakamaClient.ts', from:'JSON.stringify({ botDifficulty, supportedGameplayRulesVersions: [1, 2, 3] })', to:'JSON.stringify({ supportedGameplayRulesVersions: [1, 2, 3] })', command:'npm', args:['--workspace=apps/game','test','--','src/api/__tests__/NakamaClient.test.ts'], expected:'sends the selected bot level' },
  { file:'apps/server-nakama/store.go', from:'battlefieldID, rulesVersion, difficulty)', to:'battlefieldID, rulesVersion, "normal")', command:'go', args:['test','-count=1','-run','^TestBotDifficultyPostgresTicketsAndSettlement$','.'], cwd:'apps/server-nakama', expected:'settlement ignored pinned difficulty' },
];
const evidence = [];
for (const control of controls) {
  const original = fs.readFileSync(control.file,'utf8');
  assert.equal(original.split(control.from).length,2,'control must identify exactly one implementation site');
  const run = () => {
    const result = spawnSync(control.command, control.args, {cwd:control.cwd,env:process.env,encoding:'utf8',timeout:60000});
    assert.equal(result.error,undefined,'runner failure must not count as sensitivity');
    return {status:result.status,output:result.stdout+result.stderr};
  };
  try {
    fs.writeFileSync(control.file, original.replace(control.from,control.to));
    const red = run();
    assert.notEqual(red.status,0,'broken behavior must fail');
    assert.ok(red.output.includes(control.expected),'must fail for the intended assertion');
    evidence.push({file:control.file,negativeExit:red.status,assertion:control.expected});
  } finally { fs.writeFileSync(control.file,original); }
  const green = run();
  assert.equal(green.status,0,green.output);
  evidence.at(-1).restoredExit = green.status;
  console.log(`PASS sensitivity and restored implementation: ${control.file}`);
}
fs.mkdirSync('qa-artifacts/bot-difficulty',{recursive:true});
fs.writeFileSync('qa-artifacts/bot-difficulty/negative-controls.json',JSON.stringify(evidence,null,2));
