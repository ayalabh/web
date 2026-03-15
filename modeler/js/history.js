// Undo/Redo system using command pattern

const undoStack = [];
const redoStack = [];

export function executeCommand(command) {
  command.execute();
  undoStack.push(command);
  redoStack.length = 0;
  updateHistoryUI();
}

export function undo() {
  if (undoStack.length === 0) return;
  const command = undoStack.pop();
  command.undo();
  redoStack.push(command);
  updateHistoryUI();
}

export function redo() {
  if (redoStack.length === 0) return;
  const command = redoStack.pop();
  command.execute();
  undoStack.push(command);
  updateHistoryUI();
}

export function jumpToState(index) {
  // index is in the undoStack: 0 = first action, undoStack.length-1 = current
  const currentIndex = undoStack.length - 1;
  if (index === currentIndex) return;

  if (index < currentIndex) {
    // Undo forward
    const count = currentIndex - index;
    for (let i = 0; i < count; i++) undo();
  } else {
    // Redo forward
    const count = index - currentIndex;
    for (let i = 0; i < count; i++) redo();
  }
}

export function getUndoStack() { return undoStack; }
export function getRedoStack() { return redoStack; }

export function canUndo() { return undoStack.length > 0; }
export function canRedo() { return redoStack.length > 0; }

// Command constructors

export function createAddCommand(scene, mesh, description) {
  return {
    description: description || `Add ${mesh.userData.shapeType || 'Object'}`,
    execute() { scene.add(mesh); },
    undo() { scene.remove(mesh); }
  };
}

export function createDeleteCommand(scene, mesh, deselectFn) {
  const parent = mesh.parent || scene;
  return {
    description: `Delete ${mesh.userData.shapeType || 'Object'}`,
    execute() {
      if (deselectFn) deselectFn();
      parent.remove(mesh);
    },
    undo() { parent.add(mesh); }
  };
}

export function createMoveCommand(mesh, oldPos, newPos) {
  return {
    description: `Move ${mesh.userData.shapeType || 'Object'}`,
    execute() { mesh.position.copy(newPos); },
    undo() { mesh.position.copy(oldPos); }
  };
}

export function createRotateCommand(mesh, oldRot, newRot) {
  return {
    description: `Rotate ${mesh.userData.shapeType || 'Object'}`,
    execute() { mesh.rotation.copy(newRot); },
    undo() { mesh.rotation.copy(oldRot); }
  };
}

export function createScaleCommand(mesh, oldScale, newScale) {
  return {
    description: `Scale ${mesh.userData.shapeType || 'Object'}`,
    execute() { mesh.scale.copy(newScale); },
    undo() { mesh.scale.copy(oldScale); }
  };
}

export function createDuplicateCommand(scene, originalMesh, newMesh) {
  return {
    description: `Duplicate ${originalMesh.userData.shapeType || 'Object'}`,
    execute() { scene.add(newMesh); },
    undo() { scene.remove(newMesh); }
  };
}

export function createColorCommand(mesh, oldColor, newColor) {
  return {
    description: `Color ${mesh.userData.shapeType || 'Object'}`,
    execute() { mesh.material.color.set(newColor); },
    undo() { mesh.material.color.set(oldColor); }
  };
}

export function createOpacityCommand(mesh, oldOpacity, newOpacity) {
  return {
    description: `Opacity ${mesh.userData.shapeType || 'Object'}`,
    execute() {
      mesh.material.opacity = newOpacity;
      mesh.material.transparent = newOpacity < 1;
      mesh.material.needsUpdate = true;
    },
    undo() {
      mesh.material.opacity = oldOpacity;
      mesh.material.transparent = oldOpacity < 1;
      mesh.material.needsUpdate = true;
    }
  };
}

export function createTextureCommand(mesh, oldMap, newMap, oldColor, newColor) {
  return {
    description: `Texture ${mesh.userData.shapeType || 'Object'}`,
    execute() {
      mesh.material.map = newMap;
      if (newColor !== undefined) mesh.material.color.set(newColor);
      mesh.material.needsUpdate = true;
    },
    undo() {
      mesh.material.map = oldMap;
      if (oldColor !== undefined) mesh.material.color.set(oldColor);
      mesh.material.needsUpdate = true;
    }
  };
}

export function createGlowCommand(mesh, scene, enableGlow, addLightFn, removeLightFn) {
  const glowColor = mesh.material.color.getHex();
  return {
    description: `${enableGlow ? 'Enable' : 'Disable'} Glow ${mesh.userData.shapeType || 'Object'}`,
    execute() {
      if (enableGlow) {
        mesh.material.emissive.setHex(glowColor);
        mesh.material.emissiveIntensity = 0.3;
        addLightFn(mesh);
      } else {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
        removeLightFn(mesh);
      }
      mesh.userData.isGlowing = enableGlow;
    },
    undo() {
      if (enableGlow) {
        mesh.material.emissive.setHex(0x000000);
        mesh.material.emissiveIntensity = 0;
        removeLightFn(mesh);
      } else {
        mesh.material.emissive.setHex(glowColor);
        mesh.material.emissiveIntensity = 0.3;
        addLightFn(mesh);
      }
      mesh.userData.isGlowing = !enableGlow;
    }
  };
}

export function createCSGCommand(scene, holeObject, affectedObjects, newGeometries, oldGeometries, deselectFn) {
  return {
    description: `Hole (CSG subtract)`,
    execute() {
      if (deselectFn) deselectFn();
      for (let i = 0; i < affectedObjects.length; i++) {
        affectedObjects[i].geometry.dispose();
        affectedObjects[i].geometry = newGeometries[i];
      }
      scene.remove(holeObject);
    },
    undo() {
      for (let i = 0; i < affectedObjects.length; i++) {
        affectedObjects[i].geometry.dispose();
        affectedObjects[i].geometry = oldGeometries[i];
      }
      scene.add(holeObject);
    }
  };
}

export function createSplitCommand(scene, splitterObject, affectedObjects, oldGeometries, outsideGeometries, insideMeshes, deselectFn) {
  return {
    description: `Split (CSG)`,
    execute() {
      if (deselectFn) deselectFn();
      // Replace affected objects' geometry with outside part
      for (let i = 0; i < affectedObjects.length; i++) {
        affectedObjects[i].geometry.dispose();
        affectedObjects[i].geometry = outsideGeometries[i];
        affectedObjects[i].userData.isCSGResult = true;
      }
      // Add inside meshes
      for (const mesh of insideMeshes) {
        scene.add(mesh);
      }
      // Remove splitter
      scene.remove(splitterObject);
    },
    undo() {
      // Restore original geometries
      for (let i = 0; i < affectedObjects.length; i++) {
        affectedObjects[i].geometry.dispose();
        affectedObjects[i].geometry = oldGeometries[i];
      }
      // Remove inside meshes
      for (const mesh of insideMeshes) {
        scene.remove(mesh);
      }
      // Restore splitter
      scene.add(splitterObject);
    }
  };
}

export function createGroupCommand(scene, meshes, group, deselectFn) {
  // Store each mesh's world position/rotation/scale before grouping
  const savedTransforms = meshes.map(m => ({
    pos: m.position.clone(),
    rot: m.rotation.clone(),
    scale: m.scale.clone(),
  }));

  return {
    description: `Group ${meshes.length} objects`,
    execute() {
      if (deselectFn) deselectFn();
      for (const mesh of meshes) {
        scene.remove(mesh);
        group.add(mesh);
      }
      scene.add(group);
    },
    undo() {
      if (deselectFn) deselectFn();
      scene.remove(group);
      meshes.forEach((mesh, i) => {
        group.remove(mesh);
        // Restore original world transforms
        mesh.position.copy(savedTransforms[i].pos);
        mesh.rotation.copy(savedTransforms[i].rot);
        mesh.scale.copy(savedTransforms[i].scale);
        scene.add(mesh);
      });
    }
  };
}

export function createUngroupCommand(scene, group, meshes, savedTransforms, deselectFn) {
  return {
    description: `Ungroup ${meshes.length} objects`,
    execute() {
      if (deselectFn) deselectFn();
      scene.remove(group);
      meshes.forEach((mesh, i) => {
        group.remove(mesh);
        mesh.position.copy(savedTransforms[i].pos);
        mesh.rotation.copy(savedTransforms[i].rot);
        mesh.scale.copy(savedTransforms[i].scale);
        scene.add(mesh);
      });
    },
    undo() {
      if (deselectFn) deselectFn();
      for (const mesh of meshes) {
        scene.remove(mesh);
        // Restore the mesh's local transform relative to group
      }
      // Re-add group with children
      meshes.forEach(mesh => group.add(mesh));
      scene.add(group);
    }
  };
}

export function createCompositeCommand(subCommands, description) {
  return {
    description: description || `${subCommands.length} actions`,
    execute() { subCommands.forEach(cmd => cmd.execute()); },
    undo() {
      for (let i = subCommands.length - 1; i >= 0; i--) {
        subCommands[i].undo();
      }
    }
  };
}

export function createPaintCommand(mesh, oldImageData, newImageData) {
  return {
    description: `Paint on ${mesh.userData.shapeType || 'Object'}`,
    execute() {
      const ctx = mesh.userData.paintCanvas.getContext('2d');
      ctx.putImageData(newImageData, 0, 0);
      mesh.userData.paintTexture.needsUpdate = true;
    },
    undo() {
      const ctx = mesh.userData.paintCanvas.getContext('2d');
      ctx.putImageData(oldImageData, 0, 0);
      mesh.userData.paintTexture.needsUpdate = true;
    }
  };
}

// UI update
function updateHistoryUI() {
  const list = document.getElementById('history-list');
  if (!list) return;

  list.innerHTML = '';

  const all = [...undoStack, ...([...redoStack].reverse())];
  const currentIdx = undoStack.length - 1;

  if (all.length === 0) {
    list.innerHTML = '<div class="history-item" style="color: var(--text-secondary)">No actions yet</div>';
    return;
  }

  all.forEach((cmd, i) => {
    const item = document.createElement('div');
    item.className = 'history-item';
    item.textContent = cmd.description;

    if (i === currentIdx) {
      item.classList.add('current');
    } else if (i > currentIdx) {
      item.classList.add('undone');
    }

    item.addEventListener('click', () => jumpToState(i));
    list.appendChild(item);
  });

  // Scroll to current
  const currentEl = list.querySelector('.current');
  if (currentEl) currentEl.scrollIntoView({ block: 'nearest' });
}

export function refreshHistoryPanel() {
  updateHistoryUI();
}
