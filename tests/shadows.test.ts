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
