import * as THREE from 'three';

let selectedObjects = [];          // ordered array, last item is "primary"
const outlineMeshes = new Map();   // obj -> [outline, ...] (array for groups with multiple children)
const onSelectCallbacks = [];

// Returns the primary (most recently clicked) selected object, or null
export function getSelected() {
  return selectedObjects.length > 0 ? selectedObjects[selectedObjects.length - 1] : null;
}

// Returns a copy of all selected objects
export function getSelectedAll() {
  return [...selectedObjects];
}

export function getSelectedCount() {
  return selectedObjects.length;
}

// Given a hit object from raycasting, find the top-level selectable (group or mesh)
export function findSelectable(hit) {
  let obj = hit;
  while (obj.parent) {
    if (obj.parent.userData.isGroup) {
      obj = obj.parent;
    } else {
      break;
    }
  }
  return obj.userData.isShape ? obj : null;
}

// Plain click: clear all, select just this one
export function selectObject(mesh, scene) {
  if (selectedObjects.length === 1 && selectedObjects[0] === mesh) return;
  deselectObject(scene);
  if (!mesh) return;

  selectedObjects.push(mesh);
  addOutline(mesh);

  updateActionButtons();
  onSelectCallbacks.forEach(cb => cb(mesh));
}

// Shift+click: toggle this object in/out of the selection
export function toggleSelectObject(mesh, scene) {
  if (!mesh) return;

  const idx = selectedObjects.indexOf(mesh);
  if (idx >= 0) {
    selectedObjects.splice(idx, 1);
    removeOutline(mesh);
  } else {
    selectedObjects.push(mesh);
    addOutline(mesh);
  }

  updateActionButtons();
  onSelectCallbacks.forEach(cb => cb(getSelected()));
}

// Clear all selections
export function deselectObject(scene) {
  if (selectedObjects.length === 0) return;

  for (const obj of selectedObjects) {
    removeOutline(obj);
  }
  selectedObjects = [];

  updateActionButtons();
  onSelectCallbacks.forEach(cb => cb(null));
}

// Rebuild outlines for all selected objects
export function refreshOutline() {
  const selected = [...selectedObjects];
  for (const obj of selected) {
    removeOutline(obj);
    addOutline(obj);
  }
}

export function onSelect(callback) {
  onSelectCallbacks.push(callback);
}

// ==================== Outline Helpers ====================

function addOutlineToMesh(mesh) {
  const outlineGeo = mesh.geometry.clone();
  const outlineMat = new THREE.MeshBasicMaterial({
    color: 0x00aaff,
    wireframe: true,
    transparent: true,
    opacity: 0.5,
  });
  const outline = new THREE.Mesh(outlineGeo, outlineMat);
  outline.scale.setScalar(1.02);
  outline.raycast = () => {};
  outline.userData.isOutline = true;
  mesh.add(outline);
  return outline;
}

function addOutline(obj) {
  if (outlineMeshes.has(obj)) return;

  if (obj.userData.isGroup) {
    // Add outline to each child mesh in the group
    const outlines = [];
    obj.traverse(child => {
      if (child.isMesh && child.userData.isShape && !child.userData.isOutline) {
        outlines.push(addOutlineToMesh(child));
      }
    });
    outlineMeshes.set(obj, outlines);
  } else if (obj.geometry) {
    const outline = addOutlineToMesh(obj);
    outlineMeshes.set(obj, [outline]);
  }
}

function removeOutline(obj) {
  const outlines = outlineMeshes.get(obj);
  if (!outlines) return;
  for (const outline of outlines) {
    if (outline.parent) {
      outline.parent.remove(outline);
    }
    outline.geometry.dispose();
    outline.material.dispose();
  }
  outlineMeshes.delete(obj);
}

function updateActionButtons() {
  const hasSelection = selectedObjects.length > 0;
  const ids = ['action-delete', 'action-duplicate', 'action-texture', 'action-color', 'action-glow', 'action-hole', 'action-split'];
  ids.forEach(id => {
    const btn = document.getElementById(id);
    if (btn) btn.disabled = !hasSelection;
  });

  // Group: enabled when 2+ objects selected
  const groupBtn = document.getElementById('action-group');
  if (groupBtn) groupBtn.disabled = selectedObjects.length < 2;

  // Ungroup: enabled when exactly 1 group selected
  const ungroupBtn = document.getElementById('action-ungroup');
  if (ungroupBtn) {
    const sel = getSelected();
    ungroupBtn.disabled = !(selectedObjects.length === 1 && sel && sel.userData.isGroup);
  }
}
