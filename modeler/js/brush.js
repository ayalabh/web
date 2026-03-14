import * as THREE from 'three';

const CANVAS_SIZE = 512;

let brushActive = false;
let isPainting = false;
let brushColor = '#ff0000';
let brushSize = 10;
let activeStamp = null; // null means freehand brush
let lastUV = null;
let lastMesh = null;
let paintStartImageData = null; // for undo

// Callbacks set by main.js
let _raycaster = null;
let _camera = null;
let _objects = null;
let _onPaintDone = null; // (mesh, oldImageData, newImageData) => void

export function isBrushActive() { return brushActive; }

export function activateBrush() {
  brushActive = true;
  document.body.classList.add('brush-mode');
  document.getElementById('brush-panel').classList.remove('hidden');
  document.getElementById('action-brush').classList.add('active');
  // Deactivate tool buttons
  document.querySelectorAll('#tools-group .tool-btn').forEach(b => b.classList.remove('active'));
}

export function deactivateBrush() {
  brushActive = false;
  isPainting = false;
  document.body.classList.remove('brush-mode');
  document.getElementById('brush-panel').classList.add('hidden');
  document.getElementById('action-brush').classList.remove('active');
  // Restore select tool highlight
  document.getElementById('tool-select').classList.add('active');
}

export function initBrush(raycaster, camera, getObjects, onPaintDone) {
  _raycaster = raycaster;
  _camera = camera;
  _objects = getObjects;
  _onPaintDone = onPaintDone;

  // Color input
  const colorInput = document.getElementById('brush-color');
  colorInput.addEventListener('input', (e) => { brushColor = e.target.value; });

  // Size slider
  const sizeInput = document.getElementById('brush-size');
  const sizeLabel = document.getElementById('brush-size-label');
  sizeInput.addEventListener('input', (e) => {
    brushSize = parseInt(e.target.value);
    sizeLabel.textContent = brushSize;
  });

  // Close button
  document.querySelector('#brush-panel .panel-close').addEventListener('click', deactivateBrush);

  // Build stamp grid
  buildStampGrid();
}

// ==================== Paint Canvas Management ====================

function getOrCreatePaintCanvas(mesh) {
  if (mesh.userData.paintCanvas) return mesh.userData.paintCanvas;

  // Clone geometry so UV remapping doesn't affect shared geometry
  mesh.geometry = mesh.geometry.clone();

  // Remap UVs to atlas layout so each face group gets a unique canvas region
  const atlasInfo = remapUVsToAtlas(mesh.geometry);

  const canvas = document.createElement('canvas');
  canvas.width = CANVAS_SIZE;
  canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext('2d');

  // Pre-fill with current appearance
  if (mesh.material.map && mesh.material.map.image) {
    prefillCanvasWithTexture(ctx, mesh.material.map.image, atlasInfo);
  } else {
    ctx.fillStyle = '#' + mesh.material.color.getHexString();
    ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);
  }

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;

  mesh.userData.paintCanvas = canvas;
  mesh.userData.paintTexture = texture;
  mesh.userData.originalColor = '#' + mesh.material.color.getHexString();

  mesh.material.map = texture;
  mesh.material.color.set('#ffffff');
  mesh.material.needsUpdate = true;

  return canvas;
}

// ==================== UV Atlas Remapping ====================

function remapUVsToAtlas(geometry) {
  const groups = geometry.groups;
  if (!groups || groups.length <= 1) return null;

  const numGroups = groups.length;
  const index = geometry.index;
  const uvAttr = geometry.getAttribute('uv');
  if (!uvAttr) return null;

  // Check if any vertex is shared between groups — if so, skip (unsafe to remap)
  const vertexGroup = new Map();
  for (let gi = 0; gi < numGroups; gi++) {
    const group = groups[gi];
    for (let i = group.start; i < group.start + group.count; i++) {
      const vi = index ? index.getX(i) : i;
      if (vertexGroup.has(vi) && vertexGroup.get(vi) !== gi) {
        return null; // Shared vertex across groups, can't remap safely
      }
      vertexGroup.set(vi, gi);
    }
  }

  const cols = Math.ceil(Math.sqrt(numGroups));
  const rows = Math.ceil(numGroups / cols);
  const cellW = 1 / cols;
  const cellH = 1 / rows;

  const newUV = new Float32Array(uvAttr.array.length);
  newUV.set(uvAttr.array);

  for (let gi = 0; gi < numGroups; gi++) {
    const group = groups[gi];
    const col = gi % cols;
    const row = Math.floor(gi / cols);
    const offsetX = col * cellW;
    const offsetY = row * cellH;

    for (let i = group.start; i < group.start + group.count; i++) {
      const vi = index ? index.getX(i) : i;
      newUV[vi * 2] = offsetX + uvAttr.getX(vi) * cellW;
      newUV[vi * 2 + 1] = offsetY + uvAttr.getY(vi) * cellH;
    }
  }

  geometry.setAttribute('uv', new THREE.BufferAttribute(newUV, 2));
  return { cols, rows, numGroups };
}

function prefillCanvasWithTexture(ctx, image, atlasInfo) {
  if (!atlasInfo) {
    ctx.drawImage(image, 0, 0, CANVAS_SIZE, CANVAS_SIZE);
    return;
  }

  const { cols, rows, numGroups } = atlasInfo;
  const cellW = CANVAS_SIZE / cols;
  const cellH = CANVAS_SIZE / rows;

  // Draw texture into each atlas cell
  // Atlas row 0 (UV y near 0) maps to bottom of canvas via (1-uv.y), so canvas y = (rows-1)*cellH
  for (let gi = 0; gi < numGroups; gi++) {
    const col = gi % cols;
    const row = Math.floor(gi / cols);
    const canvasX = col * cellW;
    const canvasY = (rows - row - 1) * cellH;
    ctx.drawImage(image, canvasX, canvasY, cellW, cellH);
  }
}

// ==================== Raycasting to UV ====================

function raycastUV(e) {
  const canvasEl = document.getElementById('three-canvas');
  const rect = canvasEl.getBoundingClientRect();
  const mouse = new THREE.Vector2(
    ((e.clientX - rect.left) / rect.width) * 2 - 1,
    -((e.clientY - rect.top) / rect.height) * 2 + 1
  );
  _raycaster.setFromCamera(mouse, _camera);
  const objects = _objects();
  const intersects = _raycaster.intersectObjects(objects, false);
  if (intersects.length > 0 && intersects[0].uv) {
    return { mesh: intersects[0].object, uv: intersects[0].uv };
  }
  return null;
}

// ==================== Painting ====================

function paintAt(canvas, uv, size, color) {
  const ctx = canvas.getContext('2d');
  const x = uv.x * canvas.width;
  const y = (1 - uv.y) * canvas.height;
  ctx.beginPath();
  ctx.arc(x, y, size, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function interpolatePaint(canvas, fromUV, toUV, size, color) {
  const dx = (toUV.x - fromUV.x) * canvas.width;
  const dy = (toUV.y - fromUV.y) * canvas.height;
  const dist = Math.sqrt(dx * dx + dy * dy);
  const steps = Math.max(1, Math.ceil(dist / (size * 0.5)));
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const uv = {
      x: fromUV.x + (toUV.x - fromUV.x) * t,
      y: fromUV.y + (toUV.y - fromUV.y) * t
    };
    paintAt(canvas, uv, size, color);
  }
}

function stampAt(canvas, uv, size, color, shapeType) {
  const ctx = canvas.getContext('2d');
  const x = uv.x * canvas.width;
  const y = (1 - uv.y) * canvas.height;
  ctx.fillStyle = color;
  drawShape(ctx, x, y, size, shapeType);
}

// ==================== Mouse Handlers ====================

export function handleBrushMouseDown(e) {
  if (e.button !== 0) return;
  const hit = raycastUV(e);
  if (!hit) return;

  isPainting = true;
  lastMesh = hit.mesh;
  lastUV = hit.uv.clone();

  const canvas = getOrCreatePaintCanvas(hit.mesh);

  // Snapshot for undo
  const ctx = canvas.getContext('2d');
  paintStartImageData = ctx.getImageData(0, 0, canvas.width, canvas.height);

  // Scale brush size to canvas
  const canvasSize = brushSize * (CANVAS_SIZE / 300);

  if (activeStamp) {
    stampAt(canvas, hit.uv, canvasSize, brushColor, activeStamp);
  } else {
    paintAt(canvas, hit.uv, canvasSize, brushColor);
  }
  hit.mesh.userData.paintTexture.needsUpdate = true;
}

export function handleBrushMouseMove(e) {
  if (!isPainting || !lastMesh) return;
  const hit = raycastUV(e);
  if (!hit || hit.mesh !== lastMesh) return;

  const canvas = hit.mesh.userData.paintCanvas;
  const canvasSize = brushSize * (CANVAS_SIZE / 300);

  if (activeStamp) {
    // Don't continuously stamp while dragging
    return;
  }

  interpolatePaint(canvas, lastUV, hit.uv, canvasSize, brushColor);
  hit.mesh.userData.paintTexture.needsUpdate = true;
  lastUV = hit.uv.clone();
}

export function handleBrushMouseUp(e) {
  if (!isPainting || !lastMesh) {
    isPainting = false;
    return;
  }

  isPainting = false;

  // Create undo command
  if (lastMesh.userData.paintCanvas && paintStartImageData && _onPaintDone) {
    const ctx = lastMesh.userData.paintCanvas.getContext('2d');
    const newImageData = ctx.getImageData(0, 0, lastMesh.userData.paintCanvas.width, lastMesh.userData.paintCanvas.height);
    _onPaintDone(lastMesh, paintStartImageData, newImageData);
  }

  paintStartImageData = null;
  lastMesh = null;
  lastUV = null;
}

// ==================== Stamp Shapes ====================

const STAMP_SHAPES = [
  { name: 'circle', label: 'Circle' },
  { name: 'square', label: 'Square' },
  { name: 'triangle', label: 'Triangle' },
  { name: 'star', label: 'Star' },
  { name: 'heart', label: 'Heart' },
  { name: 'smiley', label: 'Smiley' },
  { name: 'lightning', label: 'Bolt' },
];

function drawShape(ctx, x, y, size, shapeType) {
  ctx.beginPath();
  switch (shapeType) {
    case 'circle':
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'square':
      ctx.fillRect(x - size, y - size, size * 2, size * 2);
      break;
    case 'triangle':
      ctx.moveTo(x, y - size);
      ctx.lineTo(x + size, y + size);
      ctx.lineTo(x - size, y + size);
      ctx.closePath();
      ctx.fill();
      break;
    case 'star':
      drawStar(ctx, x, y, 5, size, size * 0.45);
      ctx.fill();
      break;
    case 'heart':
      drawHeart(ctx, x, y, size);
      ctx.fill();
      break;
    case 'smiley':
      drawSmiley(ctx, x, y, size);
      break;
    case 'lightning':
      drawLightning(ctx, x, y, size);
      ctx.fill();
      break;
  }
}

function drawStar(ctx, cx, cy, points, outerR, innerR) {
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const angle = (Math.PI / points) * i - Math.PI / 2;
    const x = cx + Math.cos(angle) * r;
    const y = cy + Math.sin(angle) * r;
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function drawHeart(ctx, cx, cy, size) {
  const s = size;
  const topY = cy - s * 0.4;
  ctx.moveTo(cx, cy + s);
  // Left half
  ctx.bezierCurveTo(cx - s * 0.1, cy + s * 0.5, cx - s, cy + s * 0.2, cx - s, topY);
  ctx.bezierCurveTo(cx - s, topY - s * 0.6, cx - s * 0.3, topY - s * 0.6, cx, topY - s * 0.1);
  // Right half
  ctx.bezierCurveTo(cx + s * 0.3, topY - s * 0.6, cx + s, topY - s * 0.6, cx + s, topY);
  ctx.bezierCurveTo(cx + s, cy + s * 0.2, cx + s * 0.1, cy + s * 0.5, cx, cy + s);
  ctx.closePath();
}

function drawSmiley(ctx, cx, cy, size) {
  // Face
  ctx.arc(cx, cy, size, 0, Math.PI * 2);
  ctx.fill();
  // Eyes
  ctx.fillStyle = '#ffffff';
  ctx.beginPath();
  ctx.arc(cx - size * 0.35, cy - size * 0.25, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  ctx.beginPath();
  ctx.arc(cx + size * 0.35, cy - size * 0.25, size * 0.15, 0, Math.PI * 2);
  ctx.fill();
  // Mouth
  ctx.beginPath();
  ctx.arc(cx, cy + size * 0.1, size * 0.45, 0.1 * Math.PI, 0.9 * Math.PI);
  ctx.strokeStyle = '#ffffff';
  ctx.lineWidth = size * 0.1;
  ctx.stroke();
}

function drawLightning(ctx, cx, cy, size) {
  const s = size;
  ctx.moveTo(cx - s * 0.1, cy - s);
  ctx.lineTo(cx + s * 0.5, cy - s);
  ctx.lineTo(cx + s * 0.05, cy - s * 0.1);
  ctx.lineTo(cx + s * 0.5, cy - s * 0.1);
  ctx.lineTo(cx - s * 0.2, cy + s);
  ctx.lineTo(cx - s * 0.05, cy + s * 0.05);
  ctx.lineTo(cx - s * 0.5, cy + s * 0.05);
  ctx.closePath();
}

function buildStampGrid() {
  const grid = document.getElementById('stamp-grid');
  grid.innerHTML = '';

  // "None" button for freehand brush
  const noneBtn = document.createElement('button');
  noneBtn.className = 'stamp-btn active';
  noneBtn.title = 'Freehand brush';
  noneBtn.textContent = '~';
  noneBtn.style.fontSize = '18px';
  noneBtn.style.fontWeight = 'bold';
  noneBtn.addEventListener('click', () => {
    activeStamp = null;
    grid.querySelectorAll('.stamp-btn').forEach(b => b.classList.remove('active'));
    noneBtn.classList.add('active');
  });
  grid.appendChild(noneBtn);

  STAMP_SHAPES.forEach(shape => {
    const btn = document.createElement('button');
    btn.className = 'stamp-btn';
    btn.title = shape.label;

    // Draw preview
    const preview = document.createElement('canvas');
    preview.width = 40;
    preview.height = 40;
    const pCtx = preview.getContext('2d');
    pCtx.fillStyle = '#888888';
    drawShape(pCtx, 20, 20, 14, shape.name);
    btn.appendChild(preview);

    btn.addEventListener('click', () => {
      activeStamp = shape.name;
      grid.querySelectorAll('.stamp-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
    });

    grid.appendChild(btn);
  });
}

// ==================== Save/Load Support ====================

export function getPaintCanvasDataURL(mesh) {
  if (!mesh.userData.paintCanvas) return null;
  return mesh.userData.paintCanvas.toDataURL('image/png');
}

export function restorePaintCanvas(mesh, dataURL) {
  return new Promise((resolve) => {
    // Remap UVs to match the atlas layout used when painting was done
    mesh.geometry = mesh.geometry.clone();
    remapUVsToAtlas(mesh.geometry);

    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_SIZE;
    canvas.height = CANVAS_SIZE;
    const ctx = canvas.getContext('2d');

    const img = new Image();
    img.onload = () => {
      ctx.drawImage(img, 0, 0);

      const texture = new THREE.CanvasTexture(canvas);
      texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
      texture.colorSpace = THREE.SRGBColorSpace;

      mesh.userData.paintCanvas = canvas;
      mesh.userData.paintTexture = texture;
      mesh.material.map = texture;
      mesh.material.color.set('#ffffff');
      mesh.material.needsUpdate = true;

      resolve();
    };
    img.src = dataURL;
  });
}
