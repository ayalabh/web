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
