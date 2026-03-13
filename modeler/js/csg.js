import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION } from 'three-bvh-csg';

let evaluator = null;

function getEvaluator() {
  if (!evaluator) {
    evaluator = new Evaluator();
  }
  return evaluator;
}

export function performCSGSubtraction(holeObject, sceneObjects) {
  const eval_ = getEvaluator();
  const affectedObjects = [];
  const oldGeometries = [];
  const newGeometries = [];

  // Create brush from hole object
  const holeBrush = new Brush(holeObject.geometry.clone());
  holeBrush.position.copy(holeObject.position);
  holeBrush.rotation.copy(holeObject.rotation);
  holeBrush.scale.copy(holeObject.scale);
  holeBrush.updateMatrixWorld(true);

  for (const obj of sceneObjects) {
    if (obj === holeObject || !obj.userData.isShape) continue;

    // Quick bounding box intersection test
    const box1 = new THREE.Box3().setFromObject(holeObject);
    const box2 = new THREE.Box3().setFromObject(obj);
    if (!box1.intersectsBox(box2)) continue;

    try {
      const targetBrush = new Brush(obj.geometry.clone());
      targetBrush.position.copy(obj.position);
      targetBrush.rotation.copy(obj.rotation);
      targetBrush.scale.copy(obj.scale);
      targetBrush.updateMatrixWorld(true);

      const result = eval_.evaluate(targetBrush, holeBrush, SUBTRACTION);

      // The result geometry is in world space, transform back to object's local space
      const invMatrix = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      result.geometry.applyMatrix4(invMatrix);

      affectedObjects.push(obj);
      oldGeometries.push(obj.geometry.clone());
      newGeometries.push(result.geometry);
    } catch (e) {
      console.warn('CSG subtraction failed for object:', obj, e);
    }
  }

  return { affectedObjects, oldGeometries, newGeometries };
}
