import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
const sql=fs.readFileSync(new URL('../docs/analytics/tactical-cohorts.sql',import.meta.url),'utf8');
const raw=execFileSync('docker',['compose','exec','-T','db','psql','-U','crownclash','-d','crownclash','-X','-A','-t','-v','ON_ERROR_STOP=1'],{input:sql,encoding:'utf8'});
const report=JSON.parse(raw);if(!Array.isArray(report.cohorts)||report.cohorts.length!==2)throw Error('invalid cohort result');
fs.mkdirSync('qa-artifacts/tactical',{recursive:true});fs.writeFileSync('qa-artifacts/tactical/cohorts.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
