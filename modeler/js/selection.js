import * as THREE from 'three';

let selectedObject = null;
let outlineMesh = null;
const onSelectCallbacks = [];

export function getSelected() {
  return selectedObject;
}

export function selectObject(mesh, scene) {
  if (selectedObject === mesh) return;
  deselectObject(scene);

  if (!mesh) return;

  selectedObject = mesh;

  // Create outline effect - slightly scaled wireframe
  const outlineGeo = mesh.geometry.clone();
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
  outlineMesh.scale.setScalar(1.02);
  outlineMesh.raycast = () => {}; // Not selectable
  outlineMesh.userData.isOutline = true;
  mesh.add(outlineMesh);

  updateActionButtons(true);
  onSelectCallbacks.forEach(cb => cb(mesh));
}

export function deselectObject(scene) {
  if (!selectedObject) return;

  if (outlineMesh) {
    selectedObject.remove(outlineMesh);
    outlineMesh.geometry.dispose();
    outlineMesh.material.dispose();
    outlineMesh = null;
  }

  selectedObject = null;
  updateActionButtons(false);
  onSelectCallbacks.forEach(cb => cb(null));
}

export function refreshOutline() {
  if (!selectedObject || !outlineMesh) return;
  // Rebuild outline with current geometry
  const parent = selectedObject;
  parent.remove(outlineMesh);
  outlineMesh.geometry.dispose();
  outlineMesh.material.dispose();

  const outlineGeo = selectedObject.geometry.clone();
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  outlineMesh = new THREE.Mesh(outlineGeo, outlineMat);
  outlineMesh.scale.setScalar(1.02);
  outlineMesh.raycast = () => {};
  outlineMesh.userData.isOutline = true;
  parent.add(outlineMesh);
}

export function onSelect(callback) {
  onSelectCallbacks.push(callback);
}

function updateActionButtons(hasSelection) {
  const ids = ['action-delete', 'action-duplicate', 'action-texture', 'action-color', 'action-glow', 'action-hole'];
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasSelection;
  });
}
