import * as THREE from 'three';
import { getSelected, selectObject, deselectObject } from './selection.js';
import { executeCommand, createMoveCommand, createRotateCommand, createScaleCommand } from './history.js';

let currentTool = 'select';
let isDragging = false;
let dragStart = new THREE.Vector2();
let dragObject = null;
let dragStartPos = null;
let dragStartRot = null;
let dragStartScale = null;

// Camera reference — set by main.js
let _camera = null;
export function setCamera(cam) { _camera = cam; }

const MOVE_SPEED = 0.01;
const ROTATE_SPEED = 0.02;
const SCALE_SPEED = 0.005;
const ARROW_MOVE_STEP = 0.2;
const ARROW_ROTATE_STEP = Math.PI / 18; // 10 degrees
const ARROW_SCALE_STEP = 0.1;

// Get camera-relative right and up vectors projected onto the XZ/XY planes
function getCameraRight() {
  if (!_camera) return new THREE.Vector3(1, 0, 0);
  const right = new THREE.Vector3();
  _camera.getWorldDirection(right);
  // Camera right = cross(camera forward, world up)
  right.cross(new THREE.Vector3(0, 1, 0)).normalize();
  return right;
}

function getCameraForward() {
  if (!_camera) return new THREE.Vector3(0, 0, -1);
  const fwd = new THREE.Vector3();
  _camera.getWorldDirection(fwd);
  // Project onto XZ plane for horizontal movement
  fwd.y = 0;
  fwd.normalize();
  return fwd;
}

export function getCurrentTool() { return currentTool; }

export function setTool(tool) {
  currentTool = tool;

  // Update UI
  document.querySelectorAll('#tools-group .tool-btn').forEach(btn => {
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

  const intersects = raycaster.intersectObjects(objects, false);
  const hit = intersects.length > 0 ? intersects[0].object : null;

  if (currentTool === 'select') {
    if (hit && hit.userData.isShape) {
      selectObject(hit, scene);
    } else if (!hit) {
      deselectObject(scene);
    }
    return;
  }

  // For move/rotate/scale: need a selected object
  if (!hit && !getSelected()) {
    deselectObject(scene);
    return;
  }

  if (hit && hit.userData.isShape && hit !== getSelected()) {
    selectObject(hit, scene);
  }

  const selected = getSelected();
  if (!selected) return;

  if (currentTool === 'move' || currentTool === 'rotate' || currentTool === 'scale') {
    isDragging = true;
    dragStart.set(e.clientX, e.clientY);
    dragObject = selected;
    dragStartPos = selected.position.clone();
    dragStartRot = selected.rotation.clone();
    dragStartScale = selected.scale.clone();

    // Disable orbit controls during drag
    if (orbitControls) orbitControls.enabled = false;
  }
}

export function handleToolMouseMove(e) {
  if (!isDragging || !dragObject) return;

  const dx = e.clientX - dragStart.x;
  const dy = e.clientY - dragStart.y;

  if (currentTool === 'move') {
    const right = getCameraRight();
    const fwd = getCameraForward();

    dragObject.position.copy(dragStartPos);
    if (e.shiftKey) {
      // Shift+drag: vertical (Y axis)
      dragObject.position.y += dy * -MOVE_SPEED;
    } else {
      // Drag: camera-relative horizontal
      dragObject.position.addScaledVector(right, dx * MOVE_SPEED);
      dragObject.position.addScaledVector(fwd, dy * -MOVE_SPEED);
    }
  } else if (currentTool === 'rotate') {
    if (e.shiftKey) {
      dragObject.rotation.copy(dragStartRot);
      dragObject.rotation.z = dragStartRot.z + dx * ROTATE_SPEED;
    } else {
      dragObject.rotation.y = dragStartRot.y + dx * ROTATE_SPEED;
      dragObject.rotation.x = dragStartRot.x + dy * ROTATE_SPEED;
    }
  } else if (currentTool === 'scale') {
    if (e.ctrlKey || e.metaKey) {
      // Uniform scale
      const factor = 1 + (dx - dy) * SCALE_SPEED;
      dragObject.scale.set(
        dragStartScale.x * factor,
        dragStartScale.y * factor,
        dragStartScale.z * factor
      );
    } else if (e.shiftKey) {
      dragObject.scale.copy(dragStartScale);
      dragObject.scale.z = Math.max(0.1, dragStartScale.z + dy * -SCALE_SPEED);
    } else {
      dragObject.scale.x = Math.max(0.1, dragStartScale.x + dx * SCALE_SPEED);
      dragObject.scale.y = Math.max(0.1, dragStartScale.y - dy * SCALE_SPEED);
    }
  }
}

export function handleToolMouseUp(e, orbitControls) {
  if (!isDragging || !dragObject) {
    isDragging = false;
    return;
  }

  if (orbitControls) orbitControls.enabled = true;

  const obj = dragObject;

  if (currentTool === 'move' && !obj.position.equals(dragStartPos)) {
    const newPos = obj.position.clone();
    obj.position.copy(dragStartPos);
    executeCommand(createMoveCommand(obj, dragStartPos.clone(), newPos));
  } else if (currentTool === 'rotate') {
    const oldRot = dragStartRot.clone();
    const newRot = obj.rotation.clone();
    if (oldRot.x !== newRot.x || oldRot.y !== newRot.y || oldRot.z !== newRot.z) {
      obj.rotation.copy(oldRot);
      executeCommand(createRotateCommand(obj, oldRot, newRot));
    }
  } else if (currentTool === 'scale') {
    const oldScale = dragStartScale.clone();
    const newScale = obj.scale.clone();
    if (!oldScale.equals(newScale)) {
      obj.scale.copy(oldScale);
      executeCommand(createScaleCommand(obj, oldScale, newScale));
    }
  }

  isDragging = false;
  dragObject = null;
}

export function handleArrowKey(key, shiftKey) {
  const selected = getSelected();
  if (!selected) return;

  const right = getCameraRight();
  const fwd = getCameraForward();

  if (currentTool === 'move' || currentTool === 'select') {
    const oldPos = selected.position.clone();
    const step = ARROW_MOVE_STEP;

    if (shiftKey) {
      // Shift+arrows: vertical
      if (key === 'ArrowUp') selected.position.y += step;
      if (key === 'ArrowDown') selected.position.y -= step;
    } else {
      // Camera-relative horizontal
      if (key === 'ArrowLeft') selected.position.addScaledVector(right, -step);
      if (key === 'ArrowRight') selected.position.addScaledVector(right, step);
      if (key === 'ArrowUp') selected.position.addScaledVector(fwd, step);
      if (key === 'ArrowDown') selected.position.addScaledVector(fwd, -step);
    }

    if (!selected.position.equals(oldPos)) {
      const newPos = selected.position.clone();
      selected.position.copy(oldPos);
      executeCommand(createMoveCommand(selected, oldPos, newPos));
    }
  } else if (currentTool === 'rotate') {
    const oldRot = selected.rotation.clone();
    const step = ARROW_ROTATE_STEP;

    if (shiftKey) {
      if (key === 'ArrowUp') selected.rotation.z += step;
      if (key === 'ArrowDown') selected.rotation.z -= step;
    } else {
      if (key === 'ArrowLeft') selected.rotation.y -= step;
      if (key === 'ArrowRight') selected.rotation.y += step;
      if (key === 'ArrowUp') selected.rotation.x -= step;
      if (key === 'ArrowDown') selected.rotation.x += step;
    }

    const newRot = selected.rotation.clone();
    selected.rotation.copy(oldRot);
    executeCommand(createRotateCommand(selected, oldRot, newRot));
  } else if (currentTool === 'scale') {
    const oldScale = selected.scale.clone();
    const step = ARROW_SCALE_STEP;

    if (shiftKey) {
      if (key === 'ArrowUp') selected.scale.z = Math.max(0.1, selected.scale.z + step);
      if (key === 'ArrowDown') selected.scale.z = Math.max(0.1, selected.scale.z - step);
    } else {
      if (key === 'ArrowLeft') selected.scale.x = Math.max(0.1, selected.scale.x - step);
      if (key === 'ArrowRight') selected.scale.x = Math.max(0.1, selected.scale.x + step);
      if (key === 'ArrowUp') selected.scale.y = Math.max(0.1, selected.scale.y + step);
      if (key === 'ArrowDown') selected.scale.y = Math.max(0.1, selected.scale.y - step);
    }

    const newScale = selected.scale.clone();
    selected.scale.copy(oldScale);
    executeCommand(createScaleCommand(selected, oldScale, newScale));
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
