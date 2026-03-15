import * as THREE from 'three';
import { getSelected, getSelectedAll, selectObject, deselectObject, toggleSelectObject, findSelectable } from './selection.js';
import { executeCommand, createMoveCommand, createRotateCommand, createScaleCommand, createCompositeCommand } from './history.js';

let currentTool = 'select';
let solidFloor = false;
let isDragging = false;
let dragStart = new THREE.Vector2();

// Multi-object drag state
let dragObjects = [];
let dragStartPositions = [];
let dragOriginalPositions = [];
let dragStartRotations = [];
let dragStartQuaternions = [];
let dragStartScales = [];
let shiftOriginPositions = [];
let shiftOriginY = null;
let wasShift = false;

// Track held keys for axis constraints (1 = horizontal only, 2 = vertical only)
const heldKeys = new Set();
window.addEventListener('keydown', (e) => { heldKeys.add(e.key); });
window.addEventListener('keyup', (e) => { heldKeys.delete(e.key); });
window.addEventListener('blur', () => { heldKeys.clear(); });

// Camera reference — set by main.js
let _camera = null;
export function setCamera(cam) { _camera = cam; }
export function setSolidFloor(val) { solidFloor = val; }
export function getSolidFloor() { return solidFloor; }

function clampToFloor(obj) {
  if (!solidFloor) return;
  const box = new THREE.Box3().setFromObject(obj, true);
  if (box.min.y < 0) {
    obj.position.y -= box.min.y;
  }
}

const MOVE_SPEED = 0.01;
const ROTATE_SPEED = 0.02;
const SCALE_SPEED = 0.005;
const ARROW_MOVE_STEP = 0.2;
const ARROW_ROTATE_STEP = Math.PI / 18; // 10 degrees
const ARROW_SCALE_STEP = 0.1;

// Get camera-relative vectors
function getCameraRight() {
  if (!_camera) return new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3();
  _camera.getWorldDirection(right);
  right.cross(new THREE.Vector3(0, 1, 0)).normalize();
  return right;
}

function getCameraForward() {
  if (!_camera) return new THREE.Vector3(0, 0, -1);
  const fwd = new THREE.Vector3();
  _camera.getWorldDirection(fwd);
  fwd.y = 0;
  fwd.normalize();
  return fwd;
}

// For a given world-space direction, find which local axis (x/y/z) of the object
// is most aligned with it. Returns 'x', 'y', or 'z'.
function closestLocalAxis(worldDir, obj) {
  const q = obj.quaternion;
  const localX = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const localY = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const localZ = new THREE.Vector3(0, 0, 1).applyQuaternion(q);

  const axes = [
    { axis: 'x', dot: Math.abs(worldDir.dot(localX)) },
    { axis: 'y', dot: Math.abs(worldDir.dot(localY)) },
    { axis: 'z', dot: Math.abs(worldDir.dot(localZ)) },
  ];
  axes.sort((a, b) => b.dot - a.dot);
  return axes[0].axis;
}

// Apply camera-relative rotation via quaternions
function applyCameraRelativeRotation(obj, startQuat, dx, dy, shiftKey) {
  const right = getCameraRight();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = getCameraForward();

  const delta = new THREE.Quaternion();

  if (shiftKey) {
    // Shift: roll around camera forward axis
    delta.setFromAxisAngle(fwd, dx * ROTATE_SPEED);
  } else {
    // Horizontal drag: rotate around world up (Y)
    // Vertical drag: rotate around camera right
    const qUp = new THREE.Quaternion().setFromAxisAngle(up, dx * ROTATE_SPEED);
    const qRight = new THREE.Quaternion().setFromAxisAngle(right, dy * ROTATE_SPEED);
    delta.multiplyQuaternions(qUp, qRight);
  }

  // Apply delta in world space: newQuat = delta * startQuat
  const result = new THREE.Quaternion().multiplyQuaternions(delta, startQuat);
  obj.quaternion.copy(result);
}

// Apply camera-relative scale change
function applyCameraRelativeScale(obj, startScale, dx, dy, shiftKey, ctrlKey) {
  if (ctrlKey) {
    // Uniform scale
    const factor = 1 + (dx - dy) * SCALE_SPEED;
    obj.scale.set(
      startScale.x * factor,
      startScale.y * factor,
      startScale.z * factor
    );
    return;
  }

  obj.scale.copy(startScale);
  const right = getCameraRight();
  const up = new THREE.Vector3(0, 1, 0);
  const fwd = getCameraForward();

  if (shiftKey) {
    // Shift: scale along camera forward axis
    const axis = closestLocalAxis(fwd, obj);
    obj.scale[axis] = Math.max(0.1, startScale[axis] + dy * -SCALE_SPEED);
  } else {
    // Horizontal: scale along camera right axis
    const hAxis = closestLocalAxis(right, obj);
    obj.scale[hAxis] = Math.max(0.1, startScale[hAxis] + dx * SCALE_SPEED);
    // Vertical: scale along world up axis
    const vAxis = closestLocalAxis(up, obj);
    obj.scale[vAxis] = Math.max(0.1, startScale[vAxis] - dy * SCALE_SPEED);
  }
}

export function getCurrentTool() { return currentTool; }

export function setTool(tool) {
  currentTool = tool;

  // Update UI
  document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
    btn.classList.toggle('active', btn.dataset.tool === tool);
  });

  // Clear any placement mode
  document.body.classList.remove('placement-mode');
  document.querySelectorAll('.shape-btn').forEach(b => b.classList.remove('active'));
}

export function handleToolMouseDown(e, raycaster, camera, scene, objects, orbitControls) {
  if (e.button !== 0) return; // Only left click

  if (currentTool === 'camera') return; // OrbitControls handles it

  const mouse = getNDC(e);
  raycaster.setFromCamera(mouse, camera);

  const intersects = raycaster.intersectObjects(objects, true);
  const rawHit = intersects.length > 0 ? intersects[0].object : null;
  // Map hit to top-level selectable (group or standalone mesh)
  const hit = rawHit ? (findSelectable(rawHit) || rawHit) : null;

  if (currentTool === 'select') {
    if (hit && hit.userData.isShape) {
      if (e.shiftKey) {
        toggleSelectObject(hit, scene);
      } else {
        selectObject(hit, scene);
      }
    } else if (!hit) {
      deselectObject(scene);
    }
    return;
  }

  // For move/rotate/scale: need selected objects
  if (!hit && !getSelected()) {
    deselectObject(scene);
    return;
  }

  if (hit && hit.userData.isShape) {
    const allSelected = getSelectedAll();
    if (!allSelected.includes(hit)) {
      selectObject(hit, scene);
    }
  }

  const allSelected = getSelectedAll();
  if (allSelected.length === 0) return;

  if (currentTool === 'move' || currentTool === 'rotate' || currentTool === 'scale') {
    isDragging = true;
    dragStart.set(e.clientX, e.clientY);
    dragObjects = allSelected;
    dragStartPositions = allSelected.map(o => o.position.clone());
    dragOriginalPositions = allSelected.map(o => o.position.clone());
    dragStartRotations = allSelected.map(o => o.rotation.clone());
    dragStartQuaternions = allSelected.map(o => o.quaternion.clone());
    dragStartScales = allSelected.map(o => o.scale.clone());
    shiftOriginPositions = [];
    shiftOriginY = null;
    wasShift = false;

    // Disable orbit controls during drag
    if (orbitControls) orbitControls.enabled = false;
  }
}

export function handleToolMouseMove(e) {
  if (!isDragging || dragObjects.length === 0) return;

  let dx = e.clientX - dragStart.x;
  let dy = e.clientY - dragStart.y;

  // Axis constraints: hold 1 for horizontal only, hold 2 for vertical only
  if (heldKeys.has('1')) dy = 0;
  if (heldKeys.has('2')) dx = 0;

  if (currentTool === 'move') {
    const right = getCameraRight();
    const fwd = getCameraForward();

    if (e.shiftKey) {
      if (!wasShift) {
        shiftOriginPositions = dragObjects.map(o => o.position.clone());
        shiftOriginY = e.clientY;
        wasShift = true;
      }
      const vertDelta = (shiftOriginY - e.clientY) * MOVE_SPEED;
      dragObjects.forEach((obj, i) => {
        obj.position.copy(shiftOriginPositions[i]);
        obj.position.y += vertDelta;
        clampToFloor(obj);
      });
    } else {
      if (wasShift) {
        dragStartPositions = dragObjects.map(o => o.position.clone());
        dragStart.set(e.clientX, e.clientY);
        wasShift = false;
        shiftOriginPositions = [];
      }
      let hDx = e.clientX - dragStart.x;
      let hDy = e.clientY - dragStart.y;
      if (heldKeys.has('1')) hDy = 0;
      if (heldKeys.has('2')) hDx = 0;
      dragObjects.forEach((obj, i) => {
        obj.position.copy(dragStartPositions[i]);
        obj.position.addScaledVector(right, hDx * MOVE_SPEED);
        obj.position.addScaledVector(fwd, hDy * -MOVE_SPEED);
        clampToFloor(obj);
      });
    }
  } else if (currentTool === 'rotate') {
    dragObjects.forEach((obj, i) => {
      applyCameraRelativeRotation(obj, dragStartQuaternions[i], dx, dy, e.shiftKey);
      clampToFloor(obj);
    });
  } else if (currentTool === 'scale') {
    dragObjects.forEach((obj, i) => {
      applyCameraRelativeScale(obj, dragStartScales[i], dx, dy, e.shiftKey, e.ctrlKey || e.metaKey);
      clampToFloor(obj);
    });
  }
}

export function handleToolMouseUp(e, orbitControls) {
  if (!isDragging || dragObjects.length === 0) {
    isDragging = false;
    return;
  }

  if (orbitControls) orbitControls.enabled = true;

  const subCommands = [];

  if (currentTool === 'move') {
    dragObjects.forEach((obj, i) => {
      if (!obj.position.equals(dragOriginalPositions[i])) {
        const newPos = obj.position.clone();
        obj.position.copy(dragOriginalPositions[i]);
        subCommands.push(createMoveCommand(obj, dragOriginalPositions[i].clone(), newPos));
      }
    });
  } else if (currentTool === 'rotate') {
    dragObjects.forEach((obj, i) => {
      const oldRot = dragStartRotations[i].clone();
      const newRot = obj.rotation.clone();
      const newPos = obj.position.clone();
      const origPos = dragOriginalPositions[i];
      if (oldRot.x !== newRot.x || oldRot.y !== newRot.y || oldRot.z !== newRot.z) {
        obj.rotation.copy(oldRot);
        obj.position.copy(origPos);
        subCommands.push(createRotateCommand(obj, oldRot, newRot));
        if (!origPos.equals(newPos)) {
          subCommands.push(createMoveCommand(obj, origPos.clone(), newPos));
        }
      }
    });
  } else if (currentTool === 'scale') {
    dragObjects.forEach((obj, i) => {
      const oldScale = dragStartScales[i].clone();
      const newScale = obj.scale.clone();
      const newPos = obj.position.clone();
      const origPos = dragOriginalPositions[i];
      if (!oldScale.equals(newScale)) {
        obj.scale.copy(oldScale);
        obj.position.copy(origPos);
        subCommands.push(createScaleCommand(obj, oldScale, newScale));
        if (!origPos.equals(newPos)) {
          subCommands.push(createMoveCommand(obj, origPos.clone(), newPos));
        }
      }
    });
  }

  if (subCommands.length > 0) {
    if (subCommands.length === 1) {
      executeCommand(subCommands[0]);
    } else {
      executeCommand(createCompositeCommand(subCommands, `${currentTool.charAt(0).toUpperCase() + currentTool.slice(1)} ${dragObjects.length} object(s)`));
    }
  }

  isDragging = false;
  dragObjects = [];
}

export function handleArrowKey(key, shiftKey) {
  const allSelected = getSelectedAll();
  if (allSelected.length === 0) return;

  const right = getCameraRight();
  const fwd = getCameraForward();
  const up = new THREE.Vector3(0, 1, 0);
  const subCommands = [];

  if (currentTool === 'move' || currentTool === 'select') {
    const step = ARROW_MOVE_STEP;
    allSelected.forEach(obj => {
      const oldPos = obj.position.clone();
      if (shiftKey) {
        if (key === 'ArrowUp') obj.position.y += step;
        if (key === 'ArrowDown') obj.position.y -= step;
      } else {
        if (key === 'ArrowLeft') obj.position.addScaledVector(right, -step);
        if (key === 'ArrowRight') obj.position.addScaledVector(right, step);
        if (key === 'ArrowUp') obj.position.addScaledVector(fwd, step);
        if (key === 'ArrowDown') obj.position.addScaledVector(fwd, -step);
      }
      clampToFloor(obj);
      if (!obj.position.equals(oldPos)) {
        const newPos = obj.position.clone();
        obj.position.copy(oldPos);
        subCommands.push(createMoveCommand(obj, oldPos, newPos));
      }
    });
  } else if (currentTool === 'rotate') {
    const step = ARROW_ROTATE_STEP;
    allSelected.forEach(obj => {
      const oldRot = obj.rotation.clone();
      const startQuat = obj.quaternion.clone();

      if (shiftKey) {
        // Shift+arrows: roll around camera forward
        if (key === 'ArrowLeft' || key === 'ArrowUp') {
          const q = new THREE.Quaternion().setFromAxisAngle(fwd, step);
          obj.quaternion.premultiply(q);
        }
        if (key === 'ArrowRight' || key === 'ArrowDown') {
          const q = new THREE.Quaternion().setFromAxisAngle(fwd, -step);
          obj.quaternion.premultiply(q);
        }
      } else {
        // Left/Right: rotate around world up
        if (key === 'ArrowLeft') {
          const q = new THREE.Quaternion().setFromAxisAngle(up, step);
          obj.quaternion.premultiply(q);
        }
        if (key === 'ArrowRight') {
          const q = new THREE.Quaternion().setFromAxisAngle(up, -step);
          obj.quaternion.premultiply(q);
        }
        // Up/Down: rotate around camera right
        if (key === 'ArrowUp') {
          const q = new THREE.Quaternion().setFromAxisAngle(right, -step);
          obj.quaternion.premultiply(q);
        }
        if (key === 'ArrowDown') {
          const q = new THREE.Quaternion().setFromAxisAngle(right, step);
          obj.quaternion.premultiply(q);
        }
      }

      const posBeforeClamp = obj.position.clone();
      clampToFloor(obj);
      const newRot = obj.rotation.clone();
      const newPos = obj.position.clone();
      obj.rotation.copy(oldRot);
      obj.position.copy(posBeforeClamp);
      subCommands.push(createRotateCommand(obj, oldRot, newRot));
      if (!posBeforeClamp.equals(newPos)) {
        subCommands.push(createMoveCommand(obj, posBeforeClamp, newPos));
      }
    });
  } else if (currentTool === 'scale') {
    const step = ARROW_SCALE_STEP;
    allSelected.forEach(obj => {
      const oldScale = obj.scale.clone();

      if (shiftKey) {
        // Shift+arrows: scale along camera forward axis
        const axis = closestLocalAxis(fwd, obj);
        if (key === 'ArrowUp') obj.scale[axis] = Math.max(0.1, obj.scale[axis] + step);
        if (key === 'ArrowDown') obj.scale[axis] = Math.max(0.1, obj.scale[axis] - step);
      } else {
        // Left/Right: scale along camera right axis
        const hAxis = closestLocalAxis(right, obj);
        if (key === 'ArrowLeft') obj.scale[hAxis] = Math.max(0.1, obj.scale[hAxis] - step);
        if (key === 'ArrowRight') obj.scale[hAxis] = Math.max(0.1, obj.scale[hAxis] + step);
        // Up/Down: scale along world up axis
        const vAxis = closestLocalAxis(up, obj);
        if (key === 'ArrowUp') obj.scale[vAxis] = Math.max(0.1, obj.scale[vAxis] + step);
        if (key === 'ArrowDown') obj.scale[vAxis] = Math.max(0.1, obj.scale[vAxis] - step);
      }

      const posBeforeClamp = obj.position.clone();
      clampToFloor(obj);
      const newScale = obj.scale.clone();
      const newPos = obj.position.clone();
      obj.scale.copy(oldScale);
      obj.position.copy(posBeforeClamp);
      subCommands.push(createScaleCommand(obj, oldScale, newScale));
      if (!posBeforeClamp.equals(newPos)) {
        subCommands.push(createMoveCommand(obj, posBeforeClamp, newPos));
      }
    });
  }

  if (subCommands.length > 0) {
    if (subCommands.length === 1) {
      executeCommand(subCommands[0]);
    } else {
      executeCommand(createCompositeCommand(subCommands, `${currentTool} ${allSelected.length} object(s)`));
    }
  }
}

function getNDC(e) {
  const canvas = document.getElementById('three-canvas');
  const rect = canvas.getBoundingClientRect();
  return new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
}

export { getNDC };
