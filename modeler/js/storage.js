import * as THREE from 'three';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';

const STORAGE_KEY_PREFIX = 'shape-modeler-project-';
const PROJECT_LIST_KEY = 'shape-modeler-projects';

export function saveProject(scene, projectName, extras = {}) {
  if (!projectName) {
    projectName = prompt('Enter project name:');
    if (!projectName) return null;
  }

  const objects = [];
  scene.children.forEach(child => {
    if (!child.userData.isShape) return;
    objects.push(serializeObject(child));
  });

  const data = {
    name: projectName,
    date: new Date().toISOString(),
    objects,
    floorColor: extras.floorColor || null,
    wallColor: extras.wallColor || null,
  };

  localStorage.setItem(STORAGE_KEY_PREFIX + projectName, JSON.stringify(data));

  // Update project list
  const list = getProjectList();
  if (!list.includes(projectName)) {
    list.push(projectName);
    localStorage.setItem(PROJECT_LIST_KEY, JSON.stringify(list));
  }

  return projectName;
}

export function openProject(projectName) {
  const raw = localStorage.getItem(STORAGE_KEY_PREFIX + projectName);
  if (!raw) return null;
  return JSON.parse(raw);
}

export function getProjectList() {
  const raw = localStorage.getItem(PROJECT_LIST_KEY);
  return raw ? JSON.parse(raw) : [];
}

export function deleteProject(projectName) {
  localStorage.removeItem(STORAGE_KEY_PREFIX + projectName);
  const list = getProjectList().filter(n => n !== projectName);
  localStorage.setItem(PROJECT_LIST_KEY, JSON.stringify(list));
}

function deserializeMesh(data) {
  // Handle groups recursively
  if (data.isGroup) {
    const group = new THREE.Group();
    group.position.set(data.position.x, data.position.y, data.position.z);
    group.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
    group.scale.set(data.scale.x, data.scale.y, data.scale.z);
    group.userData.isShape = true;
    group.userData.isGroup = true;
    group.userData.shapeType = 'Group';
    if (data.children) {
      data.children.forEach(childData => {
        group.add(deserializeMesh(childData));
      });
    }
    return group;
  }

  let geometry;
  switch (data.shapeType.toLowerCase()) {
    case 'box': geometry = new THREE.BoxGeometry(1, 1, 1); break;
    case 'sphere': geometry = new THREE.SphereGeometry(0.5, 32, 32); break;
    case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
    case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
    default: geometry = new THREE.BoxGeometry(1, 1, 1);
  }

  if (data.geometry) {
    const loader = new THREE.BufferGeometryLoader();
    const geoJson = data.geometry.data ? data.geometry : { data: data.geometry };
    geometry = loader.parse(geoJson);
  }

  const matOpts = {
    color: new THREE.Color(data.color || '#cccccc'),
    roughness: 0.6,
    metalness: 0.1,
  };

  if (data.opacity !== undefined && data.opacity < 1) {
    matOpts.opacity = data.opacity;
    matOpts.transparent = true;
  }

  const material = new THREE.MeshStandardMaterial(matOpts);

  if (data.textureName) {
    material.userData.pendingTexture = data.textureName;
  }

  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(data.position.x, data.position.y, data.position.z);
  mesh.rotation.set(data.rotation.x, data.rotation.y, data.rotation.z);
  mesh.scale.set(data.scale.x, data.scale.y, data.scale.z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.shapeType = data.shapeType;
  mesh.userData.isShape = true;
  mesh.userData.isCSGResult = data.isCSGResult || false;
  if (data.paintCanvasData) {
    mesh.userData.pendingPaintData = data.paintCanvasData;
    mesh.userData.originalColor = data.originalColor || null;
  }

  return mesh;
}

export function deserializeObjects(projectData) {
  return projectData.objects.map(data => deserializeMesh(data));
}

function serializeObject(obj) {
  // Handle groups
  if (obj.userData.isGroup) {
    return {
      shapeType: 'Group',
      isGroup: true,
      position: { x: obj.position.x, y: obj.position.y, z: obj.position.z },
      rotation: { x: obj.rotation.x, y: obj.rotation.y, z: obj.rotation.z },
      scale: { x: obj.scale.x, y: obj.scale.y, z: obj.scale.z },
      children: obj.children
        .filter(c => c.userData.isShape && !c.userData.isOutline)
        .map(c => serializeObject(c)),
    };
  }

  const mesh = obj;
  const data = {
    shapeType: mesh.userData.shapeType,
    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
    scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
    color: '#' + mesh.material.color.getHexString(),
    textureName: mesh.material.map && !mesh.userData.paintCanvas ? mesh.material.map.name : null,
    isCSGResult: mesh.userData.isCSGResult || false,
    opacity: mesh.material.opacity,
    paintCanvasData: mesh.userData.paintCanvas ? mesh.userData.paintCanvas.toDataURL('image/png') : null,
    originalColor: mesh.userData.originalColor || null,
  };

  // Save geometry for non-standard shapes (CSG results, drawn shapes, etc.)
  const standardTypes = ['box', 'sphere', 'cylinder', 'cone'];
  if (mesh.userData.isCSGResult || !standardTypes.includes(mesh.userData.shapeType.toLowerCase())) {
    const plainGeo = new THREE.BufferGeometry();
    plainGeo.setAttribute('position', mesh.geometry.getAttribute('position'));
    plainGeo.setAttribute('normal', mesh.geometry.getAttribute('normal'));
    if (mesh.geometry.getAttribute('uv')) {
      plainGeo.setAttribute('uv', mesh.geometry.getAttribute('uv'));
    }
    if (mesh.geometry.index) {
      plainGeo.setIndex(mesh.geometry.index);
    }
    data.geometry = plainGeo.toJSON();
  }

  return data;
}

export function exportGLB(scene) {
  const exporter = new GLTFExporter();

  // Collect only shape meshes
  const exportScene = new THREE.Scene();
  scene.children.forEach(child => {
    if (child.userData.isShape) {
      const clone = child.clone();
      // Remove outline children
      clone.children = clone.children.filter(c => !c.userData.isOutline);
      exportScene.add(clone);
    }
  });

  exporter.parse(exportScene, (result) => {
    const blob = new Blob([result], { type: 'application/octet-stream' });
    const link = document.createElement('a');
    link.href = URL.createObjectURL(blob);
    link.download = 'model.glb';
    link.click();
    URL.revokeObjectURL(link.href);
  }, (error) => {
    console.error('Export error:', error);
    alert('Export failed: ' + error.message);
  }, { binary: true });
}
