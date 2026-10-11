import { chromium } from 'playwright';
import { build } from 'esbuild';
import vm from 'node:vm';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';

const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try {
 const host=await browser.newPage({viewport:{width:800,height:820}}),nodes=[],listeners={},errors=[];
 await host.setContent('<iframe id="plugin" name="plugin" style="width:360px;height:740px;border:0"></iframe>');
 const page=host.frame({name:'plugin'});
 const data={},node={id:'cloud-1',type:'RECTANGLE',locked:false,parent:null,x:42,y:65,width:600,height:420,name:'Cloud / Cumulus',fills:[{type:'IMAGE',imageHash:'old-image',scaleMode:'FIT'}],
  resize(w,h){this.width=w;this.height=h;},getPluginData(key){return data[key]||'';},setPluginData(key,value){data[key]=value;}};
 data['clouds-recipe-v1']=JSON.stringify({version:1,settings:{preset:'cumulus',seed:992,width:600,height:420,quality:1}});nodes.push(node);
 const currentPage={selection:[node]};let releaseStorage;const heldStorage=new Promise(r=>{releaseStorage=r;});
 let controller,initialRequest,source='null';const delivered=[];
 const deliver=message=>{delivered.push(message);return page.evaluate(({message,source})=>window.dispatchEvent(new MessageEvent('message',{...(source==='window'?{source:window}:source==='parent'?{source:parent}:{}),data:{pluginMessage:message}})),{message,source});};
 const pending=new Set();
 const figma={showUI(){},currentPage,viewport:{center:{x:0,y:0},scrollAndZoomIntoView(){}},on(event,callback){listeners[event]=callback;},notify(){},commitUndo(){},
  clientStorage:{getAsync:()=>heldStorage,setAsync:async()=>{}},
  createImage(bytes){return {hash:createHash('sha256').update(bytes).digest('hex')};},
  createRectangle(){throw new Error('Update must not create another node');},
  ui:{postMessage(message){const work=deliver(message);pending.add(work);work.finally(()=>pending.delete(work));},onmessage:null}};
 const bundle=await build({entryPoints:['code.ts'],bundle:true,write:false,target:'es2017'});
 vm.runInNewContext(bundle.outputFiles[0].text,{figma,__html__:'',Uint8Array,console});controller=figma.ui.onmessage;
 host.on('pageerror',e=>errors.push(e.message));
 await host.exposeFunction('sendToController',message=>{if(message.bytes)message.bytes=new Uint8Array(message.bytes);const request=controller(message);if(message.type==='ready')initialRequest=request;void request;});
 await host.evaluate(()=>window.addEventListener('message',event=>{if(event.source!==document.querySelector('#plugin').contentWindow)return;const m=event.data.pluginMessage;if(m)void window.sendToController({...m,...(m.bytes?{bytes:Array.from(m.bytes)}:{})});}));
 await host.locator('#plugin').evaluate((el,html)=>{el.srcdoc=html;},await readFile('ui.html','utf8'));
 await page.waitForFunction(()=>document.querySelector('#cloud-preview').dataset.ready==='true');
 // Holding preferences must not block recognizing the selected cloud.
 await page.waitForFunction(()=>!document.querySelector('#update').hasAttribute('disabled'),null,{timeout:3000});
 assert.ok(delivered.some(m=>m.type==='selection'),'Selection should arrive before preference storage completes');
 await page.locator('#seed input').fill('123');await page.locator('#seed input').press('Tab');
 node.width=700;await controller({type:'selection-request'});await Promise.all([...pending]);
 assert.equal(await page.locator('#seed input').inputValue(),'123','Selection refresh must preserve a draft');
 releaseStorage(undefined);await initialRequest;await Promise.all([...pending]);
 await page.getByRole('button',{name:'Update selected',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('resized in Figma'),null,{timeout:5000});
 assert.equal(node.width,700);assert.equal(node.fills[0].imageHash,'old-image','Delayed init must not bypass resize conflict detection');
 currentPage.selection=[];listeners.selectionchange();await Promise.all([...pending]);
 node.width=600;currentPage.selection=[node];listeners.selectionchange();await Promise.all([...pending]);
 await page.waitForFunction(()=>document.querySelector('#seed input').value==='992');
 // Exercise a real UI edit -> PNG render -> controller validation -> same-node fill replacement -> completion.
 await page.locator('#color fig-swatch').click();
 const hex=page.locator('.fig-fill-picker-dialog[open] .fig-fill-picker-ci-hex input');await hex.fill('DDEEFF');await hex.press('Tab');await hex.press('Escape');await page.locator('.fig-fill-picker-dialog[open]').waitFor({state:'hidden',timeout:3000});
 await page.getByRole('button',{name:'Update selected',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Cloud updated.'),null,{timeout:15000});
 assert.notEqual(node.fills[0].imageHash,'old-image');assert.equal(nodes.length,1);assert.equal(node.x,42);assert.equal(node.y,65);
 assert.equal(JSON.parse(data['clouds-recipe-v1']).settings.color,'#DDEEFF');
 assert.equal(await page.getByRole('button',{name:'Update selected',exact:true}).isDisabled(),false);
 // Recover a missed selection event when returning to the plugin.
 currentPage.selection=[];await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>document.querySelector('#update').hasAttribute('disabled'));
 currentPage.selection=[node];source='window';await page.evaluate(()=>window.dispatchEvent(new Event('focus')));
 await page.waitForFunction(()=>!document.querySelector('#update').hasAttribute('disabled'));
 source='parent';
 // A fresh update with no parameter changes still reaches the original node.
 await page.getByRole('button',{name:'Update selected',exact:true}).click();
 await page.waitForFunction(()=>document.querySelector('#status').textContent.startsWith('Cloud updated.'));
 assert.equal(nodes.length,1);assert.equal(node.width,600);assert.equal(node.height,420);
 node.locked=true;listeners.selectionchange();await Promise.all([...pending]);
 await page.waitForFunction(()=>document.querySelector('#update').hasAttribute('disabled'));
 assert.deepEqual(errors,[]);
 console.log(JSON.stringify({result:'PASS',checks:['immediate selection while storage is pending','draft survives refresh and delayed init preserves resize conflict protection','host messages without parent-window source','actual PNG replaces the selected node image','recipe and position preserved','completion re-enables Update','missed selection recovered on focus','repeated update','locked selection blocked']},null,2));
} finally {await browser.close();}
