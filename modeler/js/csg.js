import * as THREE from 'three';
import { Brush, Evaluator, SUBTRACTION, INTERSECTION } from 'three-bvh-csg';

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

export function performCSGSplit(splitterObject, sceneObjects) {
  const eval_ = getEvaluator();
  const affectedObjects = [];
  const outsideGeometries = [];
  const insideGeometries = [];
  const oldGeometries = [];

  // Create brush from splitter object
  const splitterBrush = new Brush(splitterObject.geometry.clone());
  splitterBrush.position.copy(splitterObject.position);
  splitterBrush.rotation.copy(splitterObject.rotation);
  splitterBrush.scale.copy(splitterObject.scale);
  splitterBrush.updateMatrixWorld(true);

  for (const obj of sceneObjects) {
    if (obj === splitterObject || !obj.userData.isShape) continue;

    // Quick bounding box intersection test
    const box1 = new THREE.Box3().setFromObject(splitterObject);
    const box2 = new THREE.Box3().setFromObject(obj);
    if (!box1.intersectsBox(box2)) continue;

    try {
      const targetBrush = new Brush(obj.geometry.clone());
      targetBrush.position.copy(obj.position);
      targetBrush.rotation.copy(obj.rotation);
      targetBrush.scale.copy(obj.scale);
      targetBrush.updateMatrixWorld(true);

      // Outside part: target - splitter
      const outsideResult = eval_.evaluate(targetBrush, splitterBrush, SUBTRACTION);
      const invMatrix = new THREE.Matrix4().copy(obj.matrixWorld).invert();
      outsideResult.geometry.applyMatrix4(invMatrix);

      // Inside part: target ∩ splitter
      const targetBrush2 = new Brush(obj.geometry.clone());
      targetBrush2.position.copy(obj.position);
      targetBrush2.rotation.copy(obj.rotation);
      targetBrush2.scale.copy(obj.scale);
      targetBrush2.updateMatrixWorld(true);

      const insideResult = eval_.evaluate(targetBrush2, splitterBrush, INTERSECTION);
      insideResult.geometry.applyMatrix4(invMatrix);

      affectedObjects.push(obj);
      oldGeometries.push(obj.geometry.clone());
      outsideGeometries.push(outsideResult.geometry);
      insideGeometries.push(insideResult.geometry);
    } catch (e) {
      console.warn('CSG split failed for object:', obj, e);
    }
  }

  return { affectedObjects, oldGeometries, outsideGeometries, insideGeometries };
}
