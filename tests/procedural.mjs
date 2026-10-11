import { build } from 'esbuild';
import { chromium } from 'playwright';
import assert from 'node:assert/strict';
import { readFile,writeFile,mkdir } from 'node:fs/promises';
const bundle=await build({stdin:{contents:"export * from './src/cloud';export * from './src/render';",resolveDir:process.cwd()},bundle:true,write:false,format:'iife',globalName:'CloudProbe'});
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROME_PATH||'/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'});
try{
 const page=await browser.newPage();await page.addScriptTag({content:bundle.outputFiles[0].text});
 const originalSVG=await readFile('tests/fixtures/original-cumulus.svg','utf8');
 const parity=await page.evaluate(async(originalSVG)=>{
  async function pixels(svg){const image=new Image();image.src=URL.createObjectURL(new Blob([svg],{type:'image/svg+xml'}));await image.decode();const c=document.createElement('canvas');c.width=500;c.height=350;const ctx=c.getContext('2d');ctx.drawImage(image,0,0);URL.revokeObjectURL(image.src);return ctx.getImageData(0,0,500,350).data;}
  const p=window.CloudProbe,a=await pixels(originalSVG),b=await pixels(p.createSVG(p.DEFAULTS,500,350));
  let max=0,changed=0;for(let i=3;i<a.length;i+=4){max=Math.max(max,Math.abs(a[i]-b[i]));if(a[i]!==b[i])changed++;}return {max,changed};
 },originalSVG);
 assert.deepEqual(parity,{max:0,changed:0},'Default silhouette must match the published original pixel for pixel');
 const results=await page.evaluate(async()=>{
  const p=window.CloudProbe,results=[];
  for(const [name,overrides]of Object.entries({normal:{width:800,height:560},wide:{width:1000,height:300},tall:{width:400,height:800},shaded:{width:800,height:560,selfShadows:true,shadowStrength:75},otherLight:{width:800,height:560,selfShadows:true,shadowStrength:75,lightAngle:315},zero:{width:800,height:560,selfShadows:true,shadowStrength:0}})){
   const settings={...p.DEFAULTS,quality:1,...overrides},bytes=await p.rasterize(settings),img=new Image();const url=URL.createObjectURL(new Blob([bytes],{type:'image/png'}));img.src=url;await img.decode();
   const c=document.createElement('canvas');c.width=img.width;c.height=img.height;const ctx=c.getContext('2d');ctx.drawImage(img,0,0);const pixels=ctx.getImageData(0,0,c.width,c.height).data;
   const bounds=p.alphaBounds(pixels,c.width,c.height,0);URL.revokeObjectURL(url);
   const normalized=document.createElement('canvas');normalized.width=64;normalized.height=64;const nc=normalized.getContext('2d');nc.drawImage(img,0,0,64,64);
   const small=Array.from(nc.getImageData(0,0,64,64).data);
   let edgeAlpha=0;for(let x=0;x<c.width;x++){edgeAlpha=Math.max(edgeAlpha,pixels[x*4+3],pixels[((c.height-1)*c.width+x)*4+3]);}for(let y=0;y<c.height;y++){edgeAlpha=Math.max(edgeAlpha,pixels[(y*c.width)*4+3],pixels[(y*c.width+c.width-1)*4+3]);}
   results.push({small,edgeAlpha,name,bytes:Array.from(bytes),pixels:Array.from(pixels),bounds,width:c.width,height:c.height,billows:p.cloudLayout(settings).ellipses.length-1});
  }
  return results;
 });
 await mkdir('artifacts/procedural',{recursive:true});for(const r of results)await writeFile(`artifacts/procedural/${r.name}.png`,new Uint8Array(r.bytes));
 const [normal,wide,_tall,shaded,other,zero]=results;
 assert.ok(wide.billows>normal.billows);
 let sizeDifference=0;for(let i=3;i<normal.small.length;i+=4)sizeDifference+=Math.abs(normal.small[i]-wide.small[i]);sizeDifference/=64*64;assert.ok(sizeDifference>8,'Wide output must differ from a normalized bitmap stretch');
 assert.deepEqual(normal.bytes,zero.bytes,'Zero-strength shadows must be exactly unshaded');
 let shadeDifference=0,lightDifference=0,maxAlphaDifference=0;
 for(let i=0;i<normal.pixels.length;i+=4){maxAlphaDifference=Math.max(maxAlphaDifference,Math.abs(normal.pixels[i+3]-shaded.pixels[i+3]));if(normal.pixels[i+3]>240){shadeDifference+=normal.pixels[i]-shaded.pixels[i];lightDifference+=Math.abs(shaded.pixels[i]-other.pixels[i]);}}
 assert.equal(maxAlphaDifference,0);assert.ok(shadeDifference>10000);assert.ok(lightDifference>1000);
 const report={result:'PASS',originalSilhouetteParity:parity,normalizedSizeDifference:sizeDifference,shadeDifference,lightDifference,maxAlphaDifference,samples:results.map(({name,bounds,width,height,billows,edgeAlpha})=>({name,bounds,width,height,billows,edgeAlpha}))};await writeFile('artifacts/procedural/results.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));
}finally{await browser.close();}
