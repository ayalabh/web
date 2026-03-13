import * as THREE from 'three';

const EXTRUDE_HEIGHT = 1;
const TUBE_RADIUS = 0.03;
const CLOSE_THRESHOLD = 20; // pixels — if start/end are this close, treat as closed shape

let points = [];
let isDrawing = false;
let canvas, ctx;
let onDoneCallback = null;

export function openDrawModal(callback) {
  onDoneCallback = callback;
  points = [];

  const modal = document.getElementById('draw-modal');
  modal.classList.remove('hidden');

  canvas = document.getElementById('draw-canvas');
  ctx = canvas.getContext('2d');
  clearCanvas();

  // Remove old listeners by cloning
  const newCanvas = canvas.cloneNode(true);
  canvas.parentNode.replaceChild(newCanvas, canvas);
  canvas = newCanvas;
  ctx = canvas.getContext('2d');

  canvas.addEventListener('mousedown', onMouseDown);
  canvas.addEventListener('mousemove', onMouseMove);
  canvas.addEventListener('mouseup', onMouseUp);
  canvas.addEventListener('mouseleave', onMouseUp);
}

function clearCanvas() {
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  // Draw light grid
  ctx.strokeStyle = '#e0e0e0';
  ctx.lineWidth = 0.5;
  for (let x = 0; x <= canvas.width; x += 25) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, canvas.height);
    ctx.stroke();
  }
  for (let y = 0; y <= canvas.height; y += 25) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(canvas.width, y);
    ctx.stroke();
  }
}

function drawStroke() {
  if (points.length < 2) return;
  clearCanvas();
  ctx.strokeStyle = '#333333';
  ctx.lineWidth = 3;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }
  ctx.stroke();

  // Show close indicator
  if (points.length > 10 && isClosed()) {
    ctx.fillStyle = 'rgba(58, 143, 212, 0.3)';
    ctx.beginPath();
    ctx.arc(points[0].x, points[0].y, CLOSE_THRESHOLD, 0, Math.PI * 2);
    ctx.fill();
  }
}

function onMouseDown(e) {
  isDrawing = true;
  points = [];
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  points.push({ x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY });
}

function onMouseMove(e) {
  if (!isDrawing) return;
  const rect = canvas.getBoundingClientRect();
  const scaleX = canvas.width / rect.width;
  const scaleY = canvas.height / rect.height;
  points.push({ x: (e.clientX - rect.left) * scaleX, y: (e.clientY - rect.top) * scaleY });
  drawStroke();
}

function onMouseUp() {
  isDrawing = false;
}

function isClosed() {
  if (points.length < 3) return false;
  const first = points[0];
  const last = points[points.length - 1];
  const dx = first.x - last.x;
  const dy = first.y - last.y;
  return Math.sqrt(dx * dx + dy * dy) < CLOSE_THRESHOLD;
}

function simplifyPoints(pts, tolerance) {
  // Ramer-Douglas-Peucker simplification
  if (pts.length <= 2) return pts;

  let maxDist = 0;
  let maxIdx = 0;
  const first = pts[0];
  const last = pts[pts.length - 1];

  for (let i = 1; i < pts.length - 1; i++) {
    const d = pointLineDistance(pts[i], first, last);
    if (d > maxDist) {
      maxDist = d;
      maxIdx = i;
    }
  }

  if (maxDist > tolerance) {
    const left = simplifyPoints(pts.slice(0, maxIdx + 1), tolerance);
    const right = simplifyPoints(pts.slice(maxIdx), tolerance);
    return left.slice(0, -1).concat(right);
  }
  return [first, last];
}

function pointLineDistance(p, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lenSq = dx * dx + dy * dy;
  if (lenSq === 0) return Math.sqrt((p.x - a.x) ** 2 + (p.y - a.y) ** 2);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / lenSq;
  t = Math.max(0, Math.min(1, t));
  const projX = a.x + t * dx;
  const projY = a.y + t * dy;
  return Math.sqrt((p.x - projX) ** 2 + (p.y - projY) ** 2);
}

function pointsToWorldCoords(pts) {
  // Convert canvas coords to world coords centered at origin
  // Canvas: 500x500, map to roughly -2.5..2.5 world units
  const scale = 5.0 / 500;
  const cx = 250;
  const cy = 250;
  return pts.map(p => ({
    x: (p.x - cx) * scale,
    y: -(p.y - cy) * scale // flip Y — canvas Y is down, world Y is up
  }));
}

export function createDrawnMesh(drawPoints) {
  const simplified = simplifyPoints(drawPoints, 2);
  if (simplified.length < 2) return null;

  const worldPts = pointsToWorldCoords(simplified);
  const closed = isClosed();

  if (closed) {
    return createExtrudedShape(worldPts);
  } else {
    return createTubeLine(worldPts);
  }
}

function createExtrudedShape(worldPts) {
  const shape = new THREE.Shape();
  shape.moveTo(worldPts[0].x, worldPts[0].y);
  for (let i = 1; i < worldPts.length; i++) {
    shape.lineTo(worldPts[i].x, worldPts[i].y);
  }
  shape.closePath();

  const extrudeSettings = {
    depth: EXTRUDE_HEIGHT,
    bevelEnabled: false,
  };

  const geometry = new THREE.ExtrudeGeometry(shape, extrudeSettings);
  // Rotate so extrusion goes along Y axis (height) instead of Z
  geometry.rotateX(-Math.PI / 2);
  // Center the geometry vertically
  geometry.translate(0, EXTRUDE_HEIGHT / 2, 0);

  const material = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.6,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.shapeType = 'Drawn Shape';
  mesh.userData.isShape = true;
  return mesh;
}

function createTubeLine(worldPts) {
  // Create a 3D curve from the 2D points, extruded in Y
  const curve3D = [];
  for (const p of worldPts) {
    curve3D.push(new THREE.Vector3(p.x, 0, -p.y));
  }

  const path = new THREE.CatmullRomCurve3(curve3D, false);
  const geometry = new THREE.TubeGeometry(path, Math.max(worldPts.length * 2, 20), TUBE_RADIUS, 8, false);
  // Move up so it sits on the grid
  geometry.translate(0, TUBE_RADIUS, 0);

  const material = new THREE.MeshStandardMaterial({
    color: 0xcccccc,
    roughness: 0.6,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.shapeType = 'Drawn Line';
  mesh.userData.isShape = true;
  return mesh;
}

// Wire up buttons
export function initDraw(onCreated) {
  document.getElementById('draw-btn').addEventListener('click', () => {
    openDrawModal(onCreated);
  });

  document.getElementById('draw-done').addEventListener('click', () => {
    if (points.length < 2) return;
    const modal = document.getElementById('draw-modal');
    modal.classList.add('hidden');
    if (onDoneCallback) {
      const mesh = createDrawnMesh(points);
      if (mesh) onDoneCallback(mesh);
    }
  });

  document.getElementById('draw-cancel').addEventListener('click', () => {
    document.getElementById('draw-modal').classList.add('hidden');
  });

  document.getElementById('draw-clear').addEventListener('click', () => {
    points = [];
    if (ctx) clearCanvas();
  });
}
