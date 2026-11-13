import crypto from 'node:crypto'; import fs from 'node:fs';
const cfg='./config.json';
if (fs.existsSync(cfg)) { console.log(fs.readFileSync(cfg,'utf8')); process.exit(0); }
const {publicKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
const der=publicKey.export({type:'spki',format:'der'});
const id=[...crypto.createHash('sha256').update(der).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join('');
fs.writeFileSync(cfg,JSON.stringify({extId:id,key:der.toString('base64'),port:17333},null,1));
console.log(id);
