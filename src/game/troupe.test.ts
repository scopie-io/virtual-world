// The troupe draws every rig it is handed, where that rig stands, in one call per kind of part — and forgets them next frame.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { Troupe } from './troupe';

const head = new THREE.SphereGeometry(0.5, 6, 4), arm = new THREE.BoxGeometry(0.2, 0.6, 0.2);
const white = new THREE.MeshBasicMaterial(), blue = new THREE.MeshBasicMaterial(), green = new THREE.MeshBasicMaterial();
function rig(jacket: THREE.Material, x: number) {
  const g = new THREE.Group(), body = new THREE.Group(); g.add(body); g.position.set(x, 0, 0); g.visible = false;
  const h = new THREE.Mesh(head, white); h.position.y = 1.7; body.add(h);
  for (const s of [-1, 1]) { const a = new THREE.Mesh(arm, jacket); a.position.set(0.5 * s, 1, 0); body.add(a); }
  return g;
}
const batches = (scene: THREE.Scene) => scene.children.filter((c): c is THREE.InstancedMesh => (c as THREE.InstancedMesh).isInstancedMesh);

test('forty rigs are a handful of draw calls, each part where its rig stands', () => {
  const scene = new THREE.Scene(), troupe = new Troupe(scene), rigs = Array.from({ length: 40 }, (_, i) => rig(i % 4 ? blue : green, i * 2));
  for (const r of rigs) scene.add(r);
  troupe.begin(); for (const r of rigs) troupe.add(r); troupe.end();
  assert.equal(troupe.drawCalls, 3, 'heads, blue arms, green arms');
  const heads = batches(scene).find((b) => b.geometry === head)!; assert.equal(heads.count, 40);
  const M = new THREE.Matrix4(), p = new THREE.Vector3(); heads.getMatrixAt(7, M); p.setFromMatrixPosition(M);
  assert.ok(Math.abs(p.x - 14) < 1e-5 && Math.abs(p.y - 1.7) < 1e-5 && p.z === 0, 'a hidden rig still has a place in the world'); // instance matrices are 32-bit
  assert.equal(batches(scene).filter((b) => b.geometry === arm).reduce((n, b) => n + b.count, 0), 80);
});

test('next frame starts empty: someone who left is not drawn again, and more rigs than fit are dropped, not a crash', () => {
  const scene = new THREE.Scene(), troupe = new Troupe(scene), a = rig(blue, 0), b = rig(blue, 3);
  troupe.begin(); troupe.add(a); troupe.add(b); troupe.end();
  troupe.begin(); troupe.add(b); troupe.end();
  assert.deepEqual(batches(scene).map((m) => m.count).sort(), [1, 2]);
  troupe.begin(); for (let i = 0; i < 200; i++) troupe.add(a); troupe.end();
  assert.ok(batches(scene).every((m) => m.count <= 128));
});
