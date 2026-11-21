import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
for (const file of fs.readdirSync('extension').filter(f=>f.endsWith('.js'))) {
 const r=spawnSync(process.execPath,['--check','extension/'+file],{stdio:'inherit'});
 if(r.status!==0) process.exit(1);
}
for(const name of ['access','ownership','hub']) {
 const r=spawnSync(process.execPath,[`server/tests/test_${name}.mjs`],{stdio:'inherit',windowsHide:true});
 if(r.status!==0) process.exit(1);
}
console.log('CORE VERIFIED');
