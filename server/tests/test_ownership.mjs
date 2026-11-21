// Worker contract check in a Chrome API mock. No real tab can be touched.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const mut = [], timers = [], listener = () => ({addListener(){}});
let detachHandler;
let policy={enabled:true,mode:'control',scope:'all'};
const noop = async () => {};
const chrome = {
  storage:{session:{get:async()=>({ctl:[1],cur:1,paused:false,codexAccessSession:'test'}),set:noop},local:{get:async()=>({codexAccess:policy})},onChanged:listener()},
  action:{setBadgeText:noop,setBadgeBackgroundColor:noop,setTitle:noop,setIcon:noop,onClicked:listener()},
  sidePanel:{setPanelBehavior:noop},
  tabs:{onRemoved:listener(),get:async id=>({id,url:'https://example.org/'}),remove:async id=>mut.push(['close',id]),ungroup:async id=>mut.push(['ungroup',id]),query:async()=>[{id:1},{id:2}]},
  debugger:{onDetach:{addListener(fn){detachHandler=fn;}},onEvent:listener(),detach:noop,attach:noop,sendCommand:noop},
  alarms:{create:noop,onAlarm:listener()},
  runtime:{onStartup:listener(),onInstalled:listener(),onMessage:listener()},
};
class Socket {constructor(){this.readyState=0;Socket.instance=this;} send(data){this.sent=JSON.parse(data);} close(){}}
let context;
class Canvas {getContext(){return {scale(){},fill(){},getImageData(){return {};}};}}
context = vm.createContext({chrome,fetch:async()=>({ok:true}),WebSocket:Socket,OffscreenCanvas:Canvas,Path2D:class{},setInterval(fn,ms){timers.push({fn,ms});},setTimeout,URL,console,importScripts(file){vm.runInContext(fs.readFileSync(new URL('../../extension/'+file,import.meta.url),'utf8'),context);}});
const worker = fs.readFileSync(new URL('../../extension/background.js',import.meta.url),'utf8');
vm.runInContext(worker + '\nglobalThis.test = {H,ready,attached,get ctl(){return ctl},attach,policyDetached};',context);
await context.test.ready;
await assert.rejects(context.test.H.tabs({action:'use',tab:99})); // positive rejection control
await context.test.H.tabs({action:'close',tab:1});
assert.deepEqual(mut,[['close',1]]); // positive control for a controlled tab
mut.length=0;
await assert.rejects(context.test.H.tabs({action:'close',tab:99}),/controlled|authorized/i);
await assert.rejects(context.test.H.tabs({action:'release',tab:99}),/controlled|authorized/i);
assert.equal(mut.length,0,'unowned tabs are never mutated');
policy={enabled:true,mode:'read',scope:'all'};
await Socket.instance.onmessage({data:JSON.stringify({id:123,method:'js',params:{code:'document.title'}})});
assert.match(Socket.instance.sent.error,/Read-only/);
policy={enabled:false,mode:'control',scope:'all'};
await Socket.instance.onmessage({data:JSON.stringify({id:124,method:'tabs',params:{action:'list'}})});
assert.match(Socket.instance.sent.error,/stopped|expired/);
policy={enabled:true,mode:'control',scope:'all'};
vm.runInContext('attached.add(1); lastAct=Date.now()-50001; busy=0; paused=false;',context);
await timers.find(t=>t.ms===5000).fn(); // detach stub deliberately emits NO onDetach event
assert.equal(context.test.attached.has(1),false,'idle detach updates state even without a Chrome event');
assert.equal(context.test.ctl.has(1),true,'idle detach preserves ownership');
await context.test.attach(1);
assert.equal(context.test.attached.has(1),true,'the next operation can reattach');
assert.equal(context.test.policyDetached.has(1),false,'old policy markers do not suppress later user cancellation');
detachHandler({tabId:1},'canceled_by_user');
assert.equal(context.test.ctl.has(1),false,'real user cancellation releases control');
console.log('LEAN OWNERSHIP VERIFIED');
