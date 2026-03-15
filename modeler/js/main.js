import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createShapeMesh, createGhostMesh, getShapeCenter } from './shapes.js';
import { getSelected, getSelectedAll, selectObject, deselectObject, toggleSelectObject, findSelectable, refreshOutline, onSelect } from './selection.js';
import { getCurrentTool, setTool, setCamera, setSolidFloor, getSolidFloor, handleToolMouseDown, handleToolMouseMove, handleToolMouseUp, getNDC } from './tools.js';
import {
  executeCommand, undo, redo,
  createAddCommand, createDeleteCommand, createDuplicateCommand,
  createColorCommand, createTextureCommand, createCSGCommand, createSplitCommand, createGroupCommand, createUngroupCommand,
  createGlowCommand,
  createOpacityCommand,
  createPaintCommand,
  createCompositeCommand,
  refreshHistoryPanel
} from './history.js';
import { initShortcuts, toggleShortcutsHelp } from './shortcuts.js';
import { getTexture, buildTextureGallery } from './textures.js';
import { initDraw, openDrawModal } from './draw.js';
import { initBrush, activateBrush, deactivateBrush, isBrushActive, handleBrushMouseDown, handleBrushMouseMove, handleBrushMouseUp, getPaintCanvasDataURL, restorePaintCanvas } from './brush.js';
import { saveProject, openProject, getProjectList, deleteProject, deserializeObjects, exportGLB } from './storage.js';
import { initTheme, toggleTheme, getTheme } from './theme.js';
import { initCategories } from './categories.js';
import { performCSGSubtraction, performCSGSplit } from './csg.js';

// ==================== Scene Setup ====================
const canvas = document.getElementById('three-canvas');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true, alpha: true });
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 1000);
camera.position.set(8, 8, 8);
camera.lookAt(0, 0, 0);
setCamera(camera);

// Controls
const orbitControls = new OrbitControls(camera, canvas);
orbitControls.enableDamping = true;
orbitControls.dampingFactor = 0.1;
orbitControls.mouseButtons = {
  LEFT: null, // Managed by tools
  MIDDLE: THREE.MOUSE.PAN,
  RIGHT: THREE.MOUSE.ROTATE,
};
orbitControls.touches = {
  ONE: null,
  TWO: THREE.TOUCH.DOLLY_PAN,
};

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
scene.add(ambientLight);

const dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
dirLight.position.set(10, 15, 10);
dirLight.castShadow = true;
dirLight.shadow.mapSize.width = 2048;
dirLight.shadow.mapSize.height = 2048;
dirLight.shadow.camera.near = 0.5;
dirLight.shadow.camera.far = 50;
dirLight.shadow.camera.left = -15;
dirLight.shadow.camera.right = 15;
dirLight.shadow.camera.top = 15;
dirLight.shadow.camera.bottom = -15;
scene.add(dirLight);

// Grid
const gridHelper = new THREE.GridHelper(20, 20, 0x444466, 0x333344);
scene.add(gridHelper);

// Ground plane for raycasting (invisible)
const groundPlane = new THREE.Mesh(
  new THREE.PlaneGeometry(100, 100),
  new THREE.MeshBasicMaterial({ visible: false })
);
groundPlane.rotation.x = -Math.PI / 2;
groundPlane.userData.isGround = true;
scene.add(groundPlane);

// Visible floor (matches grid size)
const floorMaterial = new THREE.MeshStandardMaterial({ color: 0x2a2a2a, roughness: 0.9, metalness: 0 });
const visibleFloor = new THREE.Mesh(new THREE.PlaneGeometry(20, 20), floorMaterial);
visibleFloor.rotation.x = -Math.PI / 2;
visibleFloor.position.y = -0.01;
visibleFloor.receiveShadow = true;
scene.add(visibleFloor);

// Wall (large vertical plane behind the scene)
const wallMaterial = new THREE.MeshStandardMaterial({ color: 0x0a0a1a, roughness: 0.9, metalness: 0 });
const wallMesh = new THREE.Mesh(new THREE.PlaneGeometry(100, 50), wallMaterial);
wallMesh.position.set(0, 24.99, -50);
scene.add(wallMesh);

// Light source sprite (visible sun icon in edit mode)
const lightSpriteTexture = new THREE.CanvasTexture(createSunCanvas());
const lightSprite = new THREE.Sprite(
  new THREE.SpriteMaterial({ map: lightSpriteTexture, transparent: true, depthTest: false })
);
lightSprite.scale.set(1.5, 1.5, 1);
lightSprite.position.copy(dirLight.position);
lightSprite.userData.isLightSprite = true;
lightSprite.raycast = () => {};
scene.add(lightSprite);

function createSunCanvas() {
  const size = 64;
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  // Sun body
  ctx.beginPath();
  ctx.arc(size/2, size/2, size/4, 0, Math.PI*2);
  ctx.fillStyle = '#ffdd44';
  ctx.fill();
  // Rays
  ctx.strokeStyle = '#ffdd44';
  ctx.lineWidth = 2;
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const inner = size * 0.38;
    const outer = size * 0.48;
    ctx.beginPath();
    ctx.moveTo(size/2 + Math.cos(angle)*inner, size/2 + Math.sin(angle)*inner);
    ctx.lineTo(size/2 + Math.cos(angle)*outer, size/2 + Math.sin(angle)*outer);
    ctx.stroke();
  }
  return c;
}

// ==================== Glow Management ====================
const glowLights = new Map(); // mesh -> PointLight

function addGlowLight(mesh) {
  if (glowLights.has(mesh)) return;
  const color = mesh.material.color.clone();
  const light = new THREE.PointLight(color, 5, 20, 1);
  light.position.set(0, 1.5, 0); // Above the object's center
  light.castShadow = true;
  light.shadow.mapSize.width = 1024;
  light.shadow.mapSize.height = 1024;
  light.shadow.bias = -0.002;
  light.userData.isGlowLight = true;
  mesh.add(light); // Attach to mesh so it moves with it
  glowLights.set(mesh, light);
}

function removeGlowLight(mesh) {
  const light = glowLights.get(mesh);
  if (light) {
    mesh.remove(light);
    light.dispose();
    glowLights.delete(mesh);
  }
}

// ==================== State ====================
const raycaster = new THREE.Raycaster();
let placementMode = null; // null or shape type string
let ghostMesh = null;
let currentProjectName = null;

function getSceneObjects() {
  return scene.children.filter(c => c.userData.isShape);
}

// ==================== Resize ====================
function resize() {
  const workspace = document.getElementById('workspace');
  const w = workspace.clientWidth;
  const h = workspace.clientHeight;
  renderer.setSize(w, h);
  renderer.setPixelRatio(window.devicePixelRatio);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);

// ==================== Theme ====================
initTheme();
initCategories();
let wallColor = localStorage.getItem('shape-modeler-wall-color') || null;
let floorColor = localStorage.getItem('shape-modeler-floor-color') || null;

function updateSceneTheme() {
  const isDark = getTheme() === 'dark';
  const defaultWall = isDark ? 0x0a0a1a : 0xf0f0f5;
  const defaultFloor = isDark ? 0x2a2a2a : 0xcccccc;

  const wc = wallColor ? new THREE.Color(wallColor) : new THREE.Color(defaultWall);
  const fc = floorColor ? new THREE.Color(floorColor) : new THREE.Color(defaultFloor);

  scene.background = wc.clone();
  wallMaterial.color.copy(wc);
  floorMaterial.color.copy(fc);
  gridHelper.material.opacity = isDark ? 1 : 0.5;
}
updateSceneTheme();

// ==================== Left Toolbar ====================
const leftToolbar = document.getElementById('left-toolbar');
const leftToggle = document.getElementById('left-toolbar-toggle');

leftToggle.addEventListener('click', () => {
  leftToolbar.classList.toggle('collapsed');
  leftToggle.textContent = leftToolbar.classList.contains('collapsed') ? '▶' : '◀';
  // Re-resize after animation
  setTimeout(resize, 250);
});

// Shape buttons
document.querySelectorAll('.shape-btn[data-shape]').forEach(btn => {
  btn.addEventListener('click', () => {
    enterPlacementMode(btn.dataset.shape);
  });
});

function enterPlacementMode(shapeType) {
  exitPlacementMode();
  placementMode = shapeType;
  document.body.classList.add('placement-mode');

  // Highlight active shape button
  document.querySelectorAll('.shape-btn[data-shape]').forEach(b => {
    b.classList.toggle('active', b.dataset.shape === shapeType);
  });

  // Deactivate tool buttons and brush
  document.querySelectorAll('.tool-btn[data-tool]').forEach(b => b.classList.remove('active'));
  if (isBrushActive()) deactivateBrush();

  // Create ghost
  ghostMesh = createGhostMesh(shapeType);
  ghostMesh.visible = false;
  scene.add(ghostMesh);
}

function exitPlacementMode() {
  placementMode = null;
  document.body.classList.remove('placement-mode');
  document.querySelectorAll('.shape-btn[data-shape]').forEach(b => b.classList.remove('active'));

  if (ghostMesh) {
    scene.remove(ghostMesh);
    ghostMesh.geometry.dispose();
    ghostMesh.material.dispose();
    ghostMesh = null;
  }
}

// ==================== Draw Shape ====================
function handleDrawnMesh(mesh) {
  mesh.position.set(0, 0, 0);
  executeCommand(createAddCommand(scene, mesh, `Add ${mesh.userData.shapeType}`));
  selectObject(mesh, scene);
  setTool('select');
}

initDraw(handleDrawnMesh);

function doDraw() {
  if (isBrushActive()) deactivateBrush();
  openDrawModal(handleDrawnMesh);
}

// ==================== Mouse Events ====================
canvas.addEventListener('mousedown', (e) => {
  if (previewMode) return; // Camera orbit handled by OrbitControls

  if (placementMode && e.button === 0) {
    // Place the shape
    const point = getGridPoint(e);
    if (point) {
      const mesh = createShapeMesh(placementMode);
      mesh.position.set(point.x, getShapeCenter(placementMode), point.z);
      executeCommand(createAddCommand(scene, mesh, `Add ${mesh.userData.shapeType}`));
      selectObject(mesh, scene);
    }
    exitPlacementMode();
    setTool('select');
    return;
  }

  // Brush mode: intercept left click for painting
  if (isBrushActive() && e.button === 0) {
    handleBrushMouseDown(e);
    return;
  }

  // Camera mode: let orbit controls handle left click
  if (getCurrentTool() === 'camera' && e.button === 0) {
    return;
  }

  handleToolMouseDown(e, raycaster, camera, scene, getSceneObjects(), orbitControls);
});

canvas.addEventListener('mousemove', (e) => {
  if (isBrushActive()) {
    handleBrushMouseMove(e);
    return;
  }

  if (placementMode && ghostMesh) {
    const point = getGridPoint(e);
    if (point) {
      ghostMesh.visible = true;
      ghostMesh.position.set(point.x, getShapeCenter(placementMode), point.z);
    } else {
      ghostMesh.visible = false;
    }
    return;
  }

  handleToolMouseMove(e);
});

canvas.addEventListener('mouseup', (e) => {
  if (isBrushActive()) {
    handleBrushMouseUp(e);
    return;
  }
  handleToolMouseUp(e, orbitControls);
});

// Right-click context prevention
canvas.addEventListener('contextmenu', (e) => e.preventDefault());

function getGridPoint(e) {
  const mouse = getNDC(e);
  raycaster.setFromCamera(mouse, camera);
  const intersects = raycaster.intersectObject(groundPlane);
  if (intersects.length > 0) return intersects[0].point;
  return null;
}

// ==================== Camera Mode ====================
// Update orbit controls based on tool
function updateOrbitForTool() {
  const tool = getCurrentTool();
  if (tool === 'camera') {
    orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
  } else {
    orbitControls.mouseButtons.LEFT = null;
  }
}

// Override setTool to also update orbit controls
const originalSetTool = setTool;
// We'll watch for tool changes via MutationObserver on tool buttons
const toolsObserver = new MutationObserver(() => updateOrbitForTool());
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  toolsObserver.observe(btn, { attributes: true, attributeFilter: ['class'] });
});

// ==================== Top Toolbar Buttons ====================

// Tool buttons (all buttons with data-tool, across categories)
document.querySelectorAll('.tool-btn[data-tool]').forEach(btn => {
  btn.addEventListener('click', () => {
    exitPlacementMode();
    if (isBrushActive()) deactivateBrush();
    setTool(btn.dataset.tool);
  });
});

// Delete
document.getElementById('action-delete').addEventListener('click', doDelete);
function doDelete() {
  const all = getSelectedAll();
  if (all.length === 0) return;
  deselectObject(scene);
  if (all.length === 1) {
    executeCommand(createDeleteCommand(scene, all[0], null));
  } else {
    const subCmds = all.map(obj => createDeleteCommand(scene, obj, null));
    executeCommand(createCompositeCommand(subCmds, `Delete ${all.length} objects`));
  }
}

// Duplicate
document.getElementById('action-duplicate').addEventListener('click', doDuplicate);
function doDuplicate() {
  const all = getSelectedAll();
  if (all.length === 0) return;

  const clones = [];
  const subCmds = [];
  all.forEach(sel => {
    const clone = sel.clone();
    clone.material = sel.material.clone();
    if (sel.material.map) clone.material.map = sel.material.map;
    clone.position.x += 1;
    clone.position.z += 1;
    clone.userData = { ...sel.userData, isGlowing: false };
    clone.children = clone.children.filter(c => !c.userData?.isOutline && !c.userData?.isGlowLight);
    subCmds.push(createDuplicateCommand(scene, sel, clone));
    if (sel.userData.isGlowing) {
      clone.material.emissive = clone.material.color.clone();
      clone.material.emissiveIntensity = 0.3;
      clone.userData.isGlowing = true;
      addGlowLight(clone);
    }
    clones.push(clone);
  });

  if (subCmds.length === 1) {
    executeCommand(subCmds[0]);
  } else {
    executeCommand(createCompositeCommand(subCmds, `Duplicate ${all.length} objects`));
  }

  // Select the clones
  if (clones.length > 0) {
    selectObject(clones[0], scene);
    clones.slice(1).forEach(c => toggleSelectObject(c, scene));
  }
}

// Color
document.getElementById('action-color').addEventListener('click', doColor);
const colorInput = document.getElementById('color-picker-input');
const colorPanel = document.getElementById('color-panel');
const opacitySlider = document.getElementById('opacity-slider');
const opacityLabel = document.getElementById('opacity-label');

// Track starting colors/opacities so we only add one history entry per drag
let colorDragStartColors = null;
let opacityDragStartValues = null;

// Live preview while dragging — no history entry
colorInput.addEventListener('input', (e) => {
  const all = getSelectedAll();
  if (all.length === 0) return;
  // Capture start colors on first input event of a drag
  if (!colorDragStartColors) {
    colorDragStartColors = all.map(obj => '#' + obj.material.color.getHexString());
  }
  const newColor = e.target.value;
  all.forEach(obj => obj.material.color.set(newColor));
});

// Commit to history when drag ends
colorInput.addEventListener('change', (e) => {
  const all = getSelectedAll();
  if (all.length === 0 || !colorDragStartColors) return;
  const newColor = e.target.value;
  const startColors = colorDragStartColors;
  colorDragStartColors = null;
  // Restore start colors so executeCommand's execute() applies the change
  all.forEach((obj, i) => obj.material.color.set(startColors[i]));
  if (all.length === 1) {
    executeCommand(createColorCommand(all[0], startColors[0], newColor));
  } else {
    const subCmds = all.map((obj, i) => createColorCommand(obj, startColors[i], newColor));
    executeCommand(createCompositeCommand(subCmds, `Color ${all.length} objects`));
  }
});

// Live preview while dragging opacity
opacitySlider.addEventListener('input', (e) => {
  const all = getSelectedAll();
  if (all.length === 0) return;
  if (!opacityDragStartValues) {
    opacityDragStartValues = all.map(obj => obj.material.opacity);
  }
  const newOpacity = parseInt(e.target.value) / 100;
  opacityLabel.textContent = e.target.value + '%';
  all.forEach(obj => {
    obj.material.opacity = newOpacity;
    obj.material.transparent = newOpacity < 1;
    obj.material.needsUpdate = true;
  });
});

// Commit opacity to history when drag ends
opacitySlider.addEventListener('change', (e) => {
  const all = getSelectedAll();
  if (all.length === 0 || !opacityDragStartValues) return;
  const newOpacity = parseInt(e.target.value) / 100;
  const startValues = opacityDragStartValues;
  opacityDragStartValues = null;
  // Restore start values so executeCommand's execute() applies the change
  all.forEach((obj, i) => {
    obj.material.opacity = startValues[i];
    obj.material.transparent = startValues[i] < 1;
    obj.material.needsUpdate = true;
  });
  if (all.length === 1) {
    executeCommand(createOpacityCommand(all[0], startValues[0], newOpacity));
  } else {
    const subCmds = all.map((obj, i) => createOpacityCommand(obj, startValues[i], newOpacity));
    executeCommand(createCompositeCommand(subCmds, `Opacity ${all.length} objects`));
  }
});

document.querySelector('#color-panel .panel-close').addEventListener('click', () => {
  colorPanel.classList.add('hidden');
});

// Update color panel when selection changes
onSelect((mesh) => {
  if (!colorPanel.classList.contains('hidden') && mesh) {
    colorInput.value = '#' + mesh.material.color.getHexString();
    opacitySlider.value = Math.round(mesh.material.opacity * 100);
    opacityLabel.textContent = opacitySlider.value + '%';
  }
});

function doColor() {
  const sel = getSelected();
  if (!sel) return;
  colorInput.value = '#' + sel.material.color.getHexString();
  opacitySlider.value = Math.round(sel.material.opacity * 100);
  opacityLabel.textContent = opacitySlider.value + '%';
  colorPanel.classList.toggle('hidden');
}

// Texture
document.getElementById('action-texture').addEventListener('click', doTexture);
function doTexture() {
  const all = getSelectedAll();
  if (all.length === 0) return;
  const modal = document.getElementById('texture-modal');
  buildTextureGallery((textureName) => {
    const buildCmd = (obj) => {
      const oldMap = obj.material.map;
      const oldColor = '#' + obj.material.color.getHexString();
      let newMap = null;
      let newColor = undefined;
      if (textureName) {
        newMap = getTexture(textureName);
        newColor = '#ffffff';
        // Save the real color before texture overwrites it to white
        if (!obj.userData.originalColor && !obj.userData.paintCanvas) {
          obj.userData.originalColor = oldColor;
        }
      } else {
        // "No Texture": if painted, keep paint canvas; otherwise restore original color
        if (obj.userData.paintCanvas) {
          newMap = obj.userData.paintTexture;
          newColor = '#ffffff';
        } else {
          newColor = obj.userData.originalColor || oldColor;
          obj.userData.originalColor = null;
        }
      }
      return createTextureCommand(obj, oldMap, newMap, oldColor, newColor);
    };

    if (all.length === 1) {
      executeCommand(buildCmd(all[0]));
    } else {
      const subCmds = all.map(buildCmd);
      executeCommand(createCompositeCommand(subCmds, `Texture ${all.length} objects`));
    }
    modal.classList.add('hidden');
  });
  modal.classList.remove('hidden');
}

// Hole Mode (CSG)
document.getElementById('action-hole').addEventListener('click', doHole);
function doHole() {
  const sel = getSelected();
  if (!sel) return;

  try {
    const { affectedObjects, oldGeometries, newGeometries } = performCSGSubtraction(sel, getSceneObjects());

    if (affectedObjects.length === 0) {
      alert('No intersecting objects found for subtraction.');
      return;
    }

    // Mark affected objects as CSG results
    affectedObjects.forEach(obj => { obj.userData.isCSGResult = true; });

    executeCommand(createCSGCommand(scene, sel, affectedObjects, newGeometries, oldGeometries, () => deselectObject(scene)));
  } catch (e) {
    console.error('CSG error:', e);
    alert('CSG subtraction failed. The Three.js CSG addon may not be available.\n\nError: ' + e.message);
  }
}

// Split
document.getElementById('action-split').addEventListener('click', doSplit);
function doSplit() {
  const sel = getSelected();
  if (!sel) return;

  try {
    const { affectedObjects, oldGeometries, outsideGeometries, insideGeometries } = performCSGSplit(sel, getSceneObjects());

    if (affectedObjects.length === 0) {
      alert('No intersecting objects found for splitting.');
      return;
    }

    // Create inside meshes (clones of the original objects with inside geometry)
    const insideMeshes = affectedObjects.map((obj, i) => {
      const mesh = new THREE.Mesh(insideGeometries[i], obj.material.clone());
      mesh.position.copy(obj.position);
      mesh.rotation.copy(obj.rotation);
      mesh.scale.copy(obj.scale);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.userData.shapeType = obj.userData.shapeType + ' (inner)';
      mesh.userData.isShape = true;
      mesh.userData.isCSGResult = true;
      return mesh;
    });

    executeCommand(createSplitCommand(scene, sel, affectedObjects, oldGeometries, outsideGeometries, insideMeshes, () => deselectObject(scene)));
  } catch (e) {
    console.error('CSG split error:', e);
    alert('CSG split failed.\n\nError: ' + e.message);
  }
}

// Group
document.getElementById('action-group').addEventListener('click', doGroup);
function doGroup() {
  const all = getSelectedAll();
  if (all.length < 2) return;

  const group = new THREE.Group();
  group.userData.isShape = true;
  group.userData.isGroup = true;
  group.userData.shapeType = 'Group';

  // Compute center of all objects to use as group pivot
  const center = new THREE.Vector3();
  all.forEach(obj => center.add(obj.position));
  center.divideScalar(all.length);
  group.position.copy(center);

  // Save original positions for undo
  const originalPositions = all.map(obj => obj.position.clone());

  executeCommand({
    description: `Group ${all.length} objects`,
    execute() {
      deselectObject(scene);
      for (let i = 0; i < all.length; i++) {
        scene.remove(all[i]);
        all[i].position.copy(originalPositions[i]).sub(center);
        group.add(all[i]);
      }
      scene.add(group);
    },
    undo() {
      deselectObject(scene);
      scene.remove(group);
      for (let i = 0; i < all.length; i++) {
        group.remove(all[i]);
        all[i].position.copy(originalPositions[i]);
        scene.add(all[i]);
      }
    }
  });
}

// Ungroup
document.getElementById('action-ungroup').addEventListener('click', doUngroup);
function doUngroup() {
  const sel = getSelected();
  if (!sel || !sel.userData.isGroup) return;

  const group = sel;
  const children = [...group.children.filter(c => !c.userData.isOutline)];
  const groupPos = group.position.clone();
  const groupQuat = group.quaternion.clone();
  const groupScale = group.scale.clone();

  // Compute each child's world transform for ungrouping
  const worldTransforms = children.map(child => {
    child.updateMatrixWorld(true);
    const pos = new THREE.Vector3();
    const quat = new THREE.Quaternion();
    const scl = new THREE.Vector3();
    child.matrixWorld.decompose(pos, quat, scl);
    return { pos, quat, scl };
  });
  // Save local transforms for re-grouping on undo
  const localTransforms = children.map(child => ({
    pos: child.position.clone(),
    quat: child.quaternion.clone(),
    scl: child.scale.clone(),
  }));

  executeCommand({
    description: `Ungroup ${children.length} objects`,
    execute() {
      deselectObject(scene);
      scene.remove(group);
      for (let i = 0; i < children.length; i++) {
        group.remove(children[i]);
        children[i].position.copy(worldTransforms[i].pos);
        children[i].quaternion.copy(worldTransforms[i].quat);
        children[i].scale.copy(worldTransforms[i].scl);
        scene.add(children[i]);
      }
    },
    undo() {
      deselectObject(scene);
      for (let i = 0; i < children.length; i++) {
        scene.remove(children[i]);
        children[i].position.copy(localTransforms[i].pos);
        children[i].quaternion.copy(localTransforms[i].quat);
        children[i].scale.copy(localTransforms[i].scl);
        group.add(children[i]);
      }
      scene.add(group);
    }
  });
}

// Undo/Redo
document.getElementById('action-undo').addEventListener('click', () => { undo(); deselectObject(scene); });
document.getElementById('action-redo').addEventListener('click', () => { redo(); });

// History panel
document.getElementById('action-history').addEventListener('click', doHistory);
function doHistory() {
  const panel = document.getElementById('history-panel');
  panel.classList.toggle('hidden');
  if (!panel.classList.contains('hidden')) {
    refreshHistoryPanel();
  }
}
document.querySelector('#history-panel .panel-close').addEventListener('click', () => {
  document.getElementById('history-panel').classList.add('hidden');
});

// Help button
document.getElementById('action-help').addEventListener('click', toggleShortcutsHelp);

// Brush
document.getElementById('action-brush').addEventListener('click', () => {
  if (isBrushActive()) deactivateBrush();
  else activateBrush();
});

initBrush(raycaster, camera, getSceneObjects, (mesh, oldImageData, newImageData) => {
  executeCommand(createPaintCommand(mesh, oldImageData, newImageData));
});

// Glow
const glowBtn = document.getElementById('action-glow');
glowBtn.addEventListener('click', doGlow);

function updateGlowButton() {
  const sel = getSelected();
  glowBtn.classList.toggle('active', !!(sel && sel.userData.isGlowing));
}

onSelect(updateGlowButton);

function doGlow() {
  const all = getSelectedAll();
  if (all.length === 0) return;
  const primary = getSelected();
  const enableGlow = !primary.userData.isGlowing;
  if (all.length === 1) {
    executeCommand(createGlowCommand(all[0], scene, enableGlow, addGlowLight, removeGlowLight));
  } else {
    const subCmds = all.map(obj =>
      createGlowCommand(obj, scene, enableGlow, addGlowLight, removeGlowLight)
    );
    executeCommand(createCompositeCommand(subCmds, `${enableGlow ? 'Enable' : 'Disable'} Glow`));
  }
  updateGlowButton();
}

// Light panel
const lightBtn = document.getElementById('light-btn-top');
const lightPanel = document.getElementById('light-panel');
lightBtn.addEventListener('click', () => {
  lightPanel.classList.toggle('hidden');
  lightBtn.classList.toggle('active', !lightPanel.classList.contains('hidden'));
});
document.querySelector('#light-panel .panel-close').addEventListener('click', () => {
  lightPanel.classList.add('hidden');
  lightBtn.classList.remove('active');
});
document.getElementById('light-intensity').addEventListener('input', (e) => {
  dirLight.intensity = parseFloat(e.target.value);
});
document.getElementById('light-color').addEventListener('input', (e) => {
  dirLight.color.set(e.target.value);
});

// Save
document.getElementById('action-save').addEventListener('click', doSave);
function doSave() {
  const name = saveProject(scene, currentProjectName, { floorColor, wallColor });
  if (name) {
    currentProjectName = name;
  }
}

// Open
document.getElementById('action-open').addEventListener('click', doOpen);
function doOpen() {
  const modal = document.getElementById('open-modal');
  const list = document.getElementById('project-list');
  const projects = getProjectList();

  list.innerHTML = '';
  if (projects.length === 0) {
    list.innerHTML = '<div class="no-projects">No saved projects</div>';
  } else {
    projects.forEach(name => {
      const item = document.createElement('div');
      item.className = 'project-item';

      const nameSpan = document.createElement('span');
      nameSpan.className = 'project-name';
      nameSpan.textContent = name;

      const delBtn = document.createElement('button');
      delBtn.className = 'project-delete';
      delBtn.textContent = '🗑';
      delBtn.title = 'Delete project';
      delBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (confirm(`Delete project "${name}"?`)) {
          deleteProject(name);
          doOpen(); // Refresh
        }
      });

      item.appendChild(nameSpan);
      item.appendChild(delBtn);

      item.addEventListener('click', () => {
        loadProject(name);
        modal.classList.add('hidden');
      });

      list.appendChild(item);
    });
  }

  modal.classList.remove('hidden');
}

function loadProject(name) {
  const data = openProject(name);
  if (!data) return;

  // Clear current scene objects
  deselectObject(scene);
  const toRemove = getSceneObjects();
  toRemove.forEach(obj => scene.remove(obj));

  // Load objects
  const meshes = deserializeObjects(data);
  function restoreMeshData(obj) {
    if (obj.material && obj.material.userData.pendingTexture) {
      const tex = getTexture(obj.material.userData.pendingTexture);
      if (tex) {
        obj.material.map = tex;
        obj.material.color.set('#ffffff');
        obj.material.needsUpdate = true;
      }
      delete obj.material.userData.pendingTexture;
    }
    if (obj.userData.pendingPaintData) {
      restorePaintCanvas(obj, obj.userData.pendingPaintData);
      delete obj.userData.pendingPaintData;
    }
    // Process group children
    if (obj.userData.isGroup) {
      obj.children.forEach(child => {
        if (child.userData.isShape) restoreMeshData(child);
      });
    }
  }
  meshes.forEach(mesh => {
    restoreMeshData(mesh);
    scene.add(mesh);
  });

  // Restore floor/wall colors
  floorColor = data.floorColor || null;
  wallColor = data.wallColor || null;
  if (floorColor) localStorage.setItem('shape-modeler-floor-color', floorColor);
  else localStorage.removeItem('shape-modeler-floor-color');
  if (wallColor) localStorage.setItem('shape-modeler-wall-color', wallColor);
  else localStorage.removeItem('shape-modeler-wall-color');
  updateSceneTheme();
  updateColorButtonStates();

  currentProjectName = name;
}

// Export
document.getElementById('action-export').addEventListener('click', doExport);
function doExport() {
  exportGLB(scene);
}

// Theme toggle
document.getElementById('action-theme').addEventListener('click', () => {
  toggleTheme();
  updateSceneTheme();
});

// ==================== Floor / Wall Color ====================
const floorColorInput = document.getElementById('floor-color-input');
const wallColorInput = document.getElementById('wall-color-input');

const floorBtn = document.getElementById('floor-color-btn');
const wallBtn = document.getElementById('wall-color-btn');

function updateColorButtonStates() {
  floorBtn.classList.toggle('active', !!floorColor);
  wallBtn.classList.toggle('active', !!wallColor);
}
updateColorButtonStates();

floorBtn.addEventListener('click', () => {
  floorColorInput.value = '#' + floorMaterial.color.getHexString();
  floorColorInput.click();
});
floorBtn.addEventListener('dblclick', () => {
  floorColor = null;
  localStorage.removeItem('shape-modeler-floor-color');
  updateSceneTheme();
  updateColorButtonStates();
});
floorBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  floorColor = null;
  localStorage.removeItem('shape-modeler-floor-color');
  updateSceneTheme();
  updateColorButtonStates();
});
floorColorInput.addEventListener('input', (e) => {
  floorColor = e.target.value;
  localStorage.setItem('shape-modeler-floor-color', floorColor);
  updateSceneTheme();
  updateColorButtonStates();
});

wallBtn.addEventListener('click', () => {
  wallColorInput.value = '#' + wallMaterial.color.getHexString();
  wallColorInput.click();
});
wallBtn.addEventListener('dblclick', () => {
  wallColor = null;
  localStorage.removeItem('shape-modeler-wall-color');
  updateSceneTheme();
  updateColorButtonStates();
});
wallBtn.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  wallColor = null;
  localStorage.removeItem('shape-modeler-wall-color');
  updateSceneTheme();
  updateColorButtonStates();
});
wallColorInput.addEventListener('input', (e) => {
  wallColor = e.target.value;
  localStorage.setItem('shape-modeler-wall-color', wallColor);
  updateSceneTheme();
  updateColorButtonStates();
});

// ==================== Preview Mode ====================
let previewMode = false;

function enterPreview() {
  previewMode = true;
  document.getElementById('top-toolbar').style.display = 'none';
  document.getElementById('left-toolbar').style.display = 'none';
  document.getElementById('preview-overlay').classList.remove('hidden');

  // Enable orbit on left click
  orbitControls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;

  // Hide grid + selection + light sprite
  gridHelper.visible = false;
  lightSprite.visible = false;
  deselectObject(scene);

  resize();
}

function exitPreview() {
  previewMode = false;
  document.getElementById('top-toolbar').style.display = '';
  document.getElementById('left-toolbar').style.display = '';
  document.getElementById('preview-overlay').classList.add('hidden');

  // Restore orbit controls based on current tool
  updateOrbitForTool();
  gridHelper.visible = true;
  lightSprite.visible = true;

  resize();
}

function takeScreenshot() {
  const useTransparent = confirm('Use transparent background?\n\nOK = Transparent background\nCancel = Show wall/floor colors');

  // Render one frame with the right settings
  const prevBg = scene.background;
  const prevFloorVis = visibleFloor.visible;
  const prevWallVis = wallMesh.visible;

  if (useTransparent) {
    scene.background = null;
    visibleFloor.visible = false;
    wallMesh.visible = false;
    renderer.setClearColor(0x000000, 0);
  }

  renderer.render(scene, camera);

  canvas.toBlob((blob) => {
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'screenshot.png';
    link.click();
    URL.revokeObjectURL(link.href);
  }, 'image/png');

  // Restore
  if (useTransparent) {
    scene.background = prevBg;
    visibleFloor.visible = prevFloorVis;
    wallMesh.visible = prevWallVis;
    renderer.setClearColor(0x000000, 1);
  }
}

// Solid Floor toggle
const solidFloorBtn = document.getElementById('action-solid-floor');
solidFloorBtn.addEventListener('click', () => {
  const newVal = !getSolidFloor();
  setSolidFloor(newVal);
  solidFloorBtn.classList.toggle('active', newVal);
});

document.getElementById('action-preview').addEventListener('click', enterPreview);
document.getElementById('preview-exit').addEventListener('click', exitPreview);
document.getElementById('preview-screenshot').addEventListener('click', takeScreenshot);

// Modal close buttons
document.querySelectorAll('.modal-close').forEach(btn => {
  btn.addEventListener('click', () => {
    btn.closest('.modal').classList.add('hidden');
  });
});

// Close modals on backdrop click
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });
});

// ==================== Keyboard Shortcuts ====================
initShortcuts({
  undo: () => { undo(); deselectObject(scene); },
  redo,
  save: doSave,
  open: doOpen,
  export: doExport,
  history: doHistory,
  theme: () => { toggleTheme(); updateSceneTheme(); },
  delete: doDelete,
  duplicate: doDuplicate,
  texture: doTexture,
  color: doColor,
  hole: doHole,
  split: doSplit,
  group: doGroup,
  ungroup: doUngroup,
  glow: doGlow,
  floorColor: () => { floorColorInput.value = '#' + floorMaterial.color.getHexString(); floorColorInput.click(); },
  wallColor: () => { wallColorInput.value = '#' + wallMaterial.color.getHexString(); wallColorInput.click(); },
  draw: doDraw,
  brush: () => { if (isBrushActive()) deactivateBrush(); else activateBrush(); },
  placeShape: (type) => enterPlacementMode(type),
  preview: enterPreview,
  exitPreview: () => { if (previewMode) exitPreview(); },
  isPreview: () => previewMode,
});

// ==================== Animation Loop ====================
function animate() {
  requestAnimationFrame(animate);
  orbitControls.update();
  renderer.render(scene, camera);
}

// Initial setup
resize();
animate();
