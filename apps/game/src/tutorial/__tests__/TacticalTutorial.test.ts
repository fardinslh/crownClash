import { expect, it } from 'vitest';
import { createInitialGameState, dispatchMultipleArmies, stepSimulation } from '@crown-clash/game-core';
import { TutorialController } from '../TutorialController.js';
import { resolveTacticalTrainingGuidance } from '../tacticalGuidance.js';
import { applyTrainingSandbox } from '../trainingGuidance.js';

it('finishes all stable tutorial steps using legal real attacks and routed reinforcement', () => {
  let state=createInitialGameState({gameplayRulesVersion:3});applyTrainingSandbox(state.territories);state.timeLimitSeconds=300;
  let acc={};let routed=false;const completed:string[]=[];
  const controller=new TutorialController(e=>{if(e.type==='step_completed')completed.push(e.stepId!);},{tactical:true,quick:true});
  for(let tick=0;tick<15000&&!controller.isCompleted;tick++){
    controller.onTimerTick(.02);
    if(tick%50===0){
      const step=controller.currentStepId;expect(step).not.toBeNull();
      const hint=resolveTacticalTrainingGuidance(state,step!);expect(hint.hintPath.length).toBeGreaterThanOrEqual(2);
      const target=state.territories[hint.hintPath.at(-1)!];
      const sourceIds=hint.hintPath.slice(0,-1);
      const d=dispatchMultipleArmies(sourceIds.map(id=>state.territories[id]),target,'player',.5,1,()=>`training_${tick}`,state);
      expect(d.armies.length).toBeGreaterThan(0);
      controller.onPreviewShown();Object.assign(state.territories,d.updatedSources);state.armies.push(...d.armies);
      controller.onDispatch(d.armies.map(a=>a.sourceId),target.id);
      if(target.owner==='player'){routed ||= d.armies.some(a=>(a.routeIds?.length??0)>2);controller.onReinforcement();}
    }
    if(!controller.shouldPauseSimulation){const r=stepSimulation(state,acc,.02);state=r.state;acc=r.accumulators;for(const a of r.resolvedArrivals)if(a.captured)controller.onCapture(a.targetId,a.newOwner==='player');}
  }
  expect(controller.isCompleted).toBe(true);expect(routed).toBe(true);
  expect(completed).toEqual(['drag_to_attack','preview_result','tower_roles','multi_dispatch','destroy_base']);
});
