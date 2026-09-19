// Everyone who is not you, drawn together. An astronaut is about fourteen small meshes; forty players would be more
// than five hundred draw calls, which is what makes a phone stutter — not the triangles. Here the astronauts keep their
// normal rigs (so posing and walking are the same code as the player's), are hidden from the renderer, and every frame
// their parts are copied into one instanced mesh per kind of part: all helmets in one call, all left-and-right arms in
// one call, and so on. Forty players or four: about a dozen draw calls.
import * as THREE from 'three';

const CAP = 128; // parts of one kind: 40 players + the booth crew, two arms / legs / ears each

export class Troupe {
  private batches = new Map<string, { mesh: THREE.InstancedMesh; n: number }>();
  constructor(private scene: THREE.Scene) {}

  begin() { for (const b of this.batches.values()) b.n = 0; }

  /** Draw this rig this frame. `root.visible` should be false: the rig is only a pose, the batches are what is seen. */
  add(root: THREE.Object3D) {
    root.updateWorldMatrix(true, true);
    root.traverse((o) => {
      const m = o as THREE.Mesh; if (!m.isMesh || Array.isArray(m.material)) return;
      const key = m.geometry.uuid + m.material.uuid;
      let b = this.batches.get(key);
      if (!b) {
        const mesh = new THREE.InstancedMesh(m.geometry, m.material, CAP);
        mesh.frustumCulled = false; mesh.renderOrder = m.renderOrder; mesh.count = 0; mesh.name = 'troupe'; this.scene.add(mesh);
        this.batches.set(key, b = { mesh, n: 0 });
      }
      if (b.n < CAP) b.mesh.setMatrixAt(b.n++, m.matrixWorld);
    });
  }

  end() { for (const b of this.batches.values()) { b.mesh.count = b.n; b.mesh.instanceMatrix.needsUpdate = true; } }

  get drawCalls() { let n = 0; for (const b of this.batches.values()) if (b.n) n++; return n; }
}
