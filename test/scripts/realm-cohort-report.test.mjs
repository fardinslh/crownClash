import {test} from 'node:test';import assert from 'node:assert/strict';
import {wilson,enrichReport} from '../../scripts/realm-cohort-report.mjs';
test('small samples keep uncertainty and no denominator is not zero retention',()=>{
 assert.deepEqual(wilson(0,0),{rate:null,low:null,high:null});const rate=wilson(1,2);assert.equal(rate.rate,.5);assert.ok(rate.low<.1&&rate.high>.9);assert.throws(()=>wilson(3,2),/invalid counts/);
});
test('immature revenue cannot justify scaling and campaign spend is not reused per cohort',()=>{
 const row={campaign:'ad_growth',authenticated:10,activated:5,first_complete:5,second_match:2,d1_eligible:5,d1_returned:2,d7_eligible:0,d7_returned:0,payer7_eligible:0,payers7:0,d30_eligible:0,buyers30:0,repeat_buyers30:0,net_revenue30_rials:0};
 const report=enrichReport({cohorts:[row,{...row}]},{ad_growth:1000000});assert.equal(report.campaigns[0].cacTomans,100000);assert.equal(report.campaigns[0].scaleGate,'do_not_scale');assert.equal(report.cohorts[0].evidenceStatus,'inconclusive');assert.equal(report.cohorts[0].payer7.rate,null);
 assert.throws(()=>enrichReport({},{}),/missing authoritative/);
});
