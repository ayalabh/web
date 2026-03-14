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

export function deserializeObjects(projectData) {
  return projectData.objects.map(data => {
    let geometry;
    switch (data.shapeType.toLowerCase()) {
      case 'box': geometry = new THREE.BoxGeometry(1, 1, 1); break;
      case 'sphere': geometry = new THREE.SphereGeometry(0.5, 32, 32); break;
      case 'cylinder': geometry = new THREE.CylinderGeometry(0.5, 0.5, 1, 32); break;
      case 'cone': geometry = new THREE.ConeGeometry(0.5, 1, 32); break;
      default: geometry = new THREE.BoxGeometry(1, 1, 1);
    }

    // If we have a custom geometry (from CSG or drawn shapes), use BufferGeometry from JSON
    if (data.geometry) {
      const loader = new THREE.BufferGeometryLoader();
      // toJSON() may wrap in { metadata, data } or be flat — BufferGeometryLoader expects the wrapper
      const geoJson = data.geometry.data ? data.geometry : { data: data.geometry };
      geometry = loader.parse(geoJson);
    }

    const matOpts = {
      color: new THREE.Color(data.color || '#cccccc'),
      roughness: 0.6,
      metalness: 0.1,
    };

    const material = new THREE.MeshStandardMaterial(matOpts);

    if (data.textureName) {
      // Texture will be applied after import via textures.js
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
  });
}

function serializeObject(mesh) {
  const data = {
    shapeType: mesh.userData.shapeType,
    position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
    rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
    scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
    color: '#' + mesh.material.color.getHexString(),
    textureName: mesh.material.map && !mesh.userData.paintCanvas ? mesh.material.map.name : null,
    isCSGResult: mesh.userData.isCSGResult || false,
    paintCanvasData: mesh.userData.paintCanvas ? mesh.userData.paintCanvas.toDataURL('image/png') : null,
    originalColor: mesh.userData.originalColor || null,
  };

  // Save geometry for non-standard shapes (CSG results, drawn shapes, etc.)
  const standardTypes = ['box', 'sphere', 'cylinder', 'cone'];
  if (mesh.userData.isCSGResult || !standardTypes.includes(mesh.userData.shapeType.toLowerCase())) {
    // Clone as plain BufferGeometry so toJSON() saves raw attribute data
    // (parametric geometries like ExtrudeGeometry serialize parameters instead)
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
