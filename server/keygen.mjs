import crypto from 'node:crypto';
import fs from 'node:fs';
const cfg = new URL('./config.json', import.meta.url);
const manifest = JSON.parse(fs.readFileSync(new URL('../extension/manifest.json', import.meta.url), 'utf8'));
// The manifest key is public and pins the unpacked extension ID across updates.
const der = Buffer.from(manifest.key, 'base64');
const id=[...crypto.createHash('sha256').update(der).digest().subarray(0,16)].map(b=>String.fromCharCode(97+(b>>4))+String.fromCharCode(97+(b&15))).join('');
const expected = {extId:id, port:17333};
if (fs.existsSync(cfg)) {
 const current = JSON.parse(fs.readFileSync(cfg, 'utf8'));
 if (current.extId !== id || current.port !== expected.port) throw new Error('Local config does not match the extension identity or port. Back it up before regenerating.');
} else fs.writeFileSync(cfg, JSON.stringify(expected,null,2) + '\n');
console.log('Extension identity ready: ' + id);
