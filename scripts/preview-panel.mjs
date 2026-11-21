// Render the production panel with simulated Chrome APIs. No real browser permissions change.
import fs from 'node:fs';
fs.mkdirSync('artifacts',{recursive:true});
const mock = `(() => { const listeners=[];
const local=JSON.parse(localStorage.getItem('panel-preview')||'{}'), session={};
function area(values,persist){return {async get(keys){const result={};for(const key of Array.isArray(keys)?keys:[keys])result[key]=values[key];return result;},async set(update){const changes={};for(const [key,value] of Object.entries(update)){changes[key]={oldValue:values[key],newValue:value};values[key]=value;}if(persist)localStorage.setItem('panel-preview',JSON.stringify(values));for(const listener of listeners)listener(changes,persist?'local':'session');}};}
chrome.storage={local:area(local,true),session:area(session,false),onChanged:{addListener(fn){listeners.push(fn);}}};
chrome.runtime={async sendMessage(message){if(message.t==='pause')await chrome.storage.session.set({paused:!session.paused});return {mode:session.paused?'pause':'wait',connected:true,clients:1,granted:!!local.codexAccess?.enabled,paused:!!session.paused,tabs:[],log:[],winState:null};},openOptionsPage(){}};
window.__PANEL_PREVIEW__=true; })();`;
fs.writeFileSync('artifacts/chrome-mock.js',mock);
let html=fs.readFileSync('extension/permissions.html','utf8');
html=html.replace('<head>','<head><base href="/extension/"><script src="/artifacts/chrome-mock.js"></script>');
html=html.replace('<main>','<main><p role="note">Preview · simulated Chrome APIs</p>');
fs.writeFileSync('artifacts/panel-preview.html',html);
console.log('Preview ready: http://127.0.0.1:18743/artifacts/panel-preview.html');
