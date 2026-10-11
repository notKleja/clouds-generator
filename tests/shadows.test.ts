import test from 'node:test';
import assert from 'node:assert/strict';
import { estimateShadows, shadowPixels } from '../src/shadows';
test('self-shadow estimate changes with light direction and remains deterministic',()=>{
 const w=60,h=40,alpha=new Uint8ClampedArray(w*h*4);for(let y=8;y<32;y++)for(let x=5;x<55;x++)alpha[(y*w+x)*4+3]=255;
 const left=estimateShadows(alpha,w,h,992,180),right=estimateShadows(alpha,w,h,992,0);
 assert.deepEqual(left,estimateShadows(alpha,w,h,992,180));assert.notDeepEqual(left,right);
 assert.equal(left[0],0);assert.ok(left[20*w+30]>.1);
 const pixels=shadowPixels(left,'#FFFFFF',100);assert.ok(Math.min(...pixels)>100);
 const black=shadowPixels(left,'#000000',100);for(let i=0;i<black.length;i+=4)assert.equal(black[i]+black[i+1]+black[i+2],0);
});

test('a solid slab darkens continuously away from the light without repeated shadow steps',()=>{
 const w=180,h=100,alpha=new Uint8ClampedArray(w*h*4);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++)alpha[(y*w+x)*4+3]=255;
 const field=estimateShadows(alpha,w,h,992,180);
 // Average a column to distinguish broad density variation from discrete ray bands.
 const columns=Array.from({length:w},(_,x)=>{let n=0;for(let y=10;y<90;y++)n+=field[y*w+x];return n/80;});
 let largest=0;for(let x=2;x<80;x++)largest=Math.max(largest,Math.abs(columns[x]-columns[x-1]));
 assert.ok(largest<.025,`Lighting has a repeated sampling step: ${largest}`);
 assert.ok(columns[60]>columns[10]);
});
