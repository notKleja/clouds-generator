import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULTS, normalize, cloudLayout } from '../src/cloud';
import { geometryKey } from '../src/render';
import { RecipeHistory } from '../src/interaction';

test('shape edits survive normalization, are bounded and leave the source recipe immutable', () => {
  const raw={...DEFAULTS,shape:[{x:.2,y:-.3},{x:Infinity,y:9},null]};
  const s=normalize(raw);
  assert.deepEqual(s.shape,[{x:.2,y:-.3},{x:0,y:.5},{x:0,y:0},{x:0,y:0},{x:0,y:0}]);
  s.shape[0].x=0;
  assert.equal(raw.shape[0]!.x,.2);
  assert.deepEqual(normalize({}).shape,Array.from({length:5},()=>({x:0,y:0})));
});
test('pulling the middle handle develops the cloud locally without changing the original recipe', () => {
  const before=cloudLayout(DEFAULTS),s=normalize(DEFAULTS);
  s.shape[2].y=-.3;
  const after=cloudLayout(s);
  assert.ok(after.ellipses[5].y<before.ellipses[5].y-30);
  assert.ok(Math.abs(after.ellipses[1].y-before.ellipses[1].y)<10);
  assert.notEqual(geometryKey(s),geometryKey(DEFAULTS));
  const history=new RecipeHistory(DEFAULTS);history.commit(s);
  assert.deepEqual(history.undo(s).shape,DEFAULTS.shape);
  assert.deepEqual(history.redo().shape,s.shape);
});
