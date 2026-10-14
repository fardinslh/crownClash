import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
export function wilson(success,total) {
 if (!Number.isInteger(success)||!Number.isInteger(total)||success<0||success>total) throw new Error('invalid counts');
 if(total===0)return {rate:null,low:null,high:null};
 const z=1.96,p=success/total,den=1+z*z/total,center=(p+z*z/(2*total))/den;
 const margin=z*Math.sqrt(p*(1-p)/total+z*z/(4*total*total))/den;
 return {rate:p,low:Math.max(0,center-margin),high:Math.min(1,center+margin)};
}
export function enrichReport(report,costs={}) {
 if(!Array.isArray(report.cohorts))throw new Error('missing authoritative cohorts');
 return {...report,cohorts:report.cohorts.map(c=>({...c,
  firstCompletion:wilson(Number(c.first_complete),Number(c.authenticated)),secondMatch:wilson(Number(c.second_match),Number(c.authenticated)),
  retentionD1:wilson(Number(c.d1_returned),Number(c.d1_eligible)),retentionD7:wilson(Number(c.d7_returned),Number(c.d7_eligible)),payer7:wilson(Number(c.payers7),Number(c.payer7_eligible)),
  repeat30:wilson(Number(c.repeat_buyers30),Number(c.buyers30)),
  evidenceStatus:Number(c.activated)<500||Number(c.buyers30)<20?'inconclusive':'sample_available',
 })),campaigns:[...new Set(report.cohorts.map(c=>c.campaign))].map(campaign=>{
  const rows=report.cohorts.filter(c=>c.campaign===campaign),activated=rows.reduce((s,c)=>s+Number(c.activated),0),mature=rows.reduce((s,c)=>s+Number(c.d30_eligible),0),net=rows.reduce((s,c)=>s+Number(c.net_revenue30_rials??0),0)/10;
  const buyers=rows.reduce((s,c)=>s+Number(c.buyers30),0);
  const cost=costs[campaign];if(cost!==undefined&&(!Number.isFinite(cost)||cost<=0))throw new Error('campaign cost must be positive tomans');
  const cac=cost!==undefined&&activated>0?cost/activated:null,observedNetPerActivated=mature>0?net/mature:null;
  return {campaign,activated,mature30:mature,spendTomans:cost??null,verifiedBuyers30:buyers,cacTomans:cac,netRevenue30Tomans:net,observedNetPerActivated30Tomans:observedNetPerActivated,scaleGate:cac!==null&&mature>=500&&buyers>=20&&observedNetPerActivated>=1.2*cac?'economic_gate_met':'do_not_scale'};
 })};
}
if(process.argv[1]===new URL(import.meta.url).pathname){
 const costs=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8')):{};
 const query=fs.readFileSync(new URL('../docs/analytics/realm-cohorts.sql',import.meta.url),'utf8');
 const raw=execFileSync('docker',['compose','exec','-T','db','psql','-U','crownclash','-d','crownclash','-v','ON_ERROR_STOP=1','-Atc',query],{encoding:'utf8'});
 const report=enrichReport(JSON.parse(raw),costs),out=path.resolve('qa-artifacts/realm-cohort-report.json');fs.mkdirSync(path.dirname(out),{recursive:true});fs.writeFileSync(out,JSON.stringify(report,null,2));console.log(`Wrote ${report.cohorts.length} cohorts to ${out}; empty/small cohorts are inconclusive.`);
}
