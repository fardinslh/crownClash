import {expect,it} from 'vitest';
import { TutorialController } from '../TutorialController.js';
it('teaches an attack, capture and base without forcing advanced controls',()=>{
 const steps:string[]=[];const controller=new TutorialController(e=>{if(e.type==='step_entered')steps.push(e.stepId!);},{quick:true});
 expect(controller.currentStep?.instruction).toContain('برج آبی');
 controller.onDispatch(['p_base'],'n_bot_left');expect(controller.currentStepId).toBe('tower_roles');
 controller.onTimerTick(2);controller.onCapture('n_bot_left',true);expect(controller.currentStepId).toBe('destroy_base');
 controller.onCapture('e_base',true);expect(controller.isCompleted).toBe(true);expect(steps).toEqual(['drag_to_attack','tower_roles','destroy_base']);
});
