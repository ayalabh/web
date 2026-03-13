import * as THREE from 'three';

const DEFAULT_COLOR = 0xcccccc;

export function createShapeGeometry(type) {
  switch (type) {
    case 'box':
      return new THREE.BoxGeometry(1, 1, 1);
    case 'sphere':
      return new THREE.SphereGeometry(0.5, 32, 32);
    case 'cylinder':
      return new THREE.CylinderGeometry(0.5, 0.5, 1, 32);
    case 'cone':
      return new THREE.ConeGeometry(0.5, 1, 32);
    default:
      return new THREE.BoxGeometry(1, 1, 1);
  }
}

export function createShapeMesh(type) {
  const geometry = createShapeGeometry(type);
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    roughness: 0.6,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData.shapeType = type.charAt(0).toUpperCase() + type.slice(1);
  mesh.userData.isShape = true;
  return mesh;
}

export function createGhostMesh(type) {
  const geometry = createShapeGeometry(type);
  const material = new THREE.MeshStandardMaterial({
    color: DEFAULT_COLOR,
    transparent: true,
    opacity: 0.4,
    roughness: 0.6,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.userData.isGhost = true;
  mesh.raycast = () => {}; // Not selectable
  return mesh;
}

export function getShapeCenter(type) {
  // Returns the Y offset needed so the shape sits on the grid
  switch (type) {
    case 'box': return 0.5;
    case 'sphere': return 0.5;
    case 'cylinder': return 0.5;
    case 'cone': return 0.5;
    default: return 0.5;
  }
}
