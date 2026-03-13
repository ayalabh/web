import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

import { createShapeMesh, createGhostMesh, getShapeCenter } from './shapes.js';
import { getSelected, selectObject, deselectObject, refreshOutline, onSelect } from './selection.js';
import { getCurrentTool, setTool, setCamera, handleToolMouseDown, handleToolMouseMove, handleToolMouseUp, getNDC } from './tools.js';
import {
  executeCommand, undo, redo,
  createAddCommand, createDeleteCommand, createDuplicateCommand,
  createColorCommand, createTextureCommand, createCSGCommand,
  createGlowCommand,
  refreshHistoryPanel
} from './history.js';
import { initShortcuts, toggleShortcutsHelp } from './shortcuts.js';
import { getTexture, buildTextureGallery } from './textures.js';
import { initDraw, openDrawModal } from './draw.js';
import { saveProject, openProject, getProjectList, deleteProject, deserializeObjects, exportGLB } from './storage.js';
import { initTheme, toggleTheme, getTheme } from './theme.js';

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

  // Deactivate tool buttons
  document.querySelectorAll('#tools-group .tool-btn').forEach(b => b.classList.remove('active'));

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

  // Camera mode: let orbit controls handle left click
  if (getCurrentTool() === 'camera' && e.button === 0) {
    return;
  }

  handleToolMouseDown(e, raycaster, camera, scene, getSceneObjects(), orbitControls);
});

canvas.addEventListener('mousemove', (e) => {
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
document.querySelectorAll('#tools-group .tool-btn').forEach(btn => {
  toolsObserver.observe(btn, { attributes: true, attributeFilter: ['class'] });
});

// ==================== Top Toolbar Buttons ====================

// Tool buttons
document.querySelectorAll('#tools-group .tool-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    exitPlacementMode();
    setTool(btn.dataset.tool);
  });
});

// Delete
document.getElementById('action-delete').addEventListener('click', doDelete);
function doDelete() {
  const sel = getSelected();
  if (!sel) return;
  executeCommand(createDeleteCommand(scene, sel, () => deselectObject(scene)));
}

// Duplicate
document.getElementById('action-duplicate').addEventListener('click', doDuplicate);
function doDuplicate() {
  const sel = getSelected();
  if (!sel) return;

  const clone = sel.clone();
  clone.material = sel.material.clone();
  if (sel.material.map) {
    clone.material.map = sel.material.map;
  }
  clone.position.x += 1;
  clone.position.z += 1;
  clone.userData = { ...sel.userData, isGlowing: false };
  // Remove outline and glow light children from clone
  clone.children = clone.children.filter(c => !c.userData?.isOutline && !c.userData?.isGlowLight);

  executeCommand(createDuplicateCommand(scene, sel, clone));

  // If original was glowing, make clone glow too
  if (sel.userData.isGlowing) {
    clone.material.emissive = clone.material.color.clone();
    clone.material.emissiveIntensity = 0.3;
    clone.userData.isGlowing = true;
    addGlowLight(clone);
  }
  selectObject(clone, scene);
}

// Color
document.getElementById('action-color').addEventListener('click', doColor);
const colorInput = document.getElementById('color-picker-input');
colorInput.addEventListener('input', (e) => {
  const sel = getSelected();
  if (!sel) return;
  const oldColor = '#' + sel.material.color.getHexString();
  const newColor = e.target.value;
  executeCommand(createColorCommand(sel, oldColor, newColor));
});
function doColor() {
  const sel = getSelected();
  if (!sel) return;
  colorInput.value = '#' + sel.material.color.getHexString();
  colorInput.click();
}

// Texture
document.getElementById('action-texture').addEventListener('click', doTexture);
function doTexture() {
  const sel = getSelected();
  if (!sel) return;
  const modal = document.getElementById('texture-modal');
  buildTextureGallery((textureName) => {
    const oldMap = sel.material.map;
    const oldColor = '#' + sel.material.color.getHexString();
    let newMap = null;
    let newColor = undefined;

    if (textureName) {
      newMap = getTexture(textureName);
      newColor = '#ffffff'; // Reset color to white so texture shows properly
    }

    executeCommand(createTextureCommand(sel, oldMap, newMap, oldColor, newColor));
    modal.classList.add('hidden');
  });
  modal.classList.remove('hidden');
}

// Hole Mode (CSG)
document.getElementById('action-hole').addEventListener('click', doHole);
async function doHole() {
  const sel = getSelected();
  if (!sel) return;

  try {
    // Dynamic import of CSG module
    const { performCSGSubtraction } = await import('./csg.js');
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

// Glow
const glowBtn = document.getElementById('action-glow');
glowBtn.addEventListener('click', doGlow);

function updateGlowButton() {
  const sel = getSelected();
  glowBtn.classList.toggle('active', !!(sel && sel.userData.isGlowing));
}

onSelect(updateGlowButton);

function doGlow() {
  const sel = getSelected();
  if (!sel) return;
  const enableGlow = !sel.userData.isGlowing;
  executeCommand(createGlowCommand(sel, scene, enableGlow, addGlowLight, removeGlowLight));
  updateGlowButton();
}

// Light panel
const lightBtn = document.getElementById('light-btn');
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
  meshes.forEach(mesh => {
    // Apply pending textures
    if (mesh.material.userData.pendingTexture) {
      const tex = getTexture(mesh.material.userData.pendingTexture);
      if (tex) {
        mesh.material.map = tex;
        mesh.material.color.set('#ffffff');
        mesh.material.needsUpdate = true;
      }
      delete mesh.material.userData.pendingTexture;
    }
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
  glow: doGlow,
  floorColor: () => { floorColorInput.value = '#' + floorMaterial.color.getHexString(); floorColorInput.click(); },
  wallColor: () => { wallColorInput.value = '#' + wallMaterial.color.getHexString(); wallColorInput.click(); },
  draw: doDraw,
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
