import { setTool, handleArrowKey } from './tools.js';

let handlers = {};

export function initShortcuts(actionHandlers) {
  handlers = actionHandlers;

  window.addEventListener('keydown', (e) => {
    // Ignore if typing in an input
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    const ctrl = e.ctrlKey || e.metaKey;
    const shift = e.shiftKey;
    const key = e.key;

    // Escape exits preview
    if (key === 'Escape') {
      handlers.exitPreview?.();
      return;
    }

    // In preview mode, only allow Escape
    if (handlers.isPreview?.()) return;

    // Arrow keys
    if (key.startsWith('Arrow')) {
      e.preventDefault();
      handleArrowKey(key, shift);
      return;
    }

    // Shift combos (no ctrl)
    if (shift && !ctrl) {
      switch (key.toLowerCase()) {
        case 'f':
          e.preventDefault();
          handlers.floorColor?.();
          return;
        case 'w':
          e.preventDefault();
          handlers.wallColor?.();
          return;
        case 'h':
          e.preventDefault();
          handlers.history?.();
          return;
        case 'd':
          e.preventDefault();
          handlers.draw?.();
          return;
      }
    }

    // Ctrl combos
    if (ctrl) {
      switch (key.toLowerCase()) {
        case 'z':
          e.preventDefault();
          if (shift) handlers.redo?.();
          else handlers.undo?.();
          return;
        case 's':
          e.preventDefault();
          handlers.save?.();
          return;
        case 'o':
          e.preventDefault();
          handlers.open?.();
          return;
        case 'e':
          e.preventDefault();
          handlers.export?.();
          return;
        case 'q':
          e.preventDefault();
          handlers.theme?.();
          return;
        case 'm':
          e.preventDefault();
          setTool('camera');
          return;
      }
      return;
    }

    // Help shortcut (works without ctrl)
    // '?' is Shift+/ on most layouts; check both e.key and the slash+shift combo
    if (key === '?' || (key === '/' && shift)) {
      toggleShortcutsHelp();
      return;
    }

    // Single key shortcuts (no ctrl)
    switch (key.toLowerCase()) {
      case 's': setTool('select'); break;
      case 'm': setTool('move'); break;
      case 'r': setTool('rotate'); break;
      case 'a': setTool('scale'); break;
      case 'c': handlers.placeShape?.('cylinder'); break;
      case 'b': handlers.placeShape?.('sphere'); break;
      case 'u': handlers.placeShape?.('box'); break;
      case 'o': handlers.placeShape?.('cone'); break;
      case 'd': handlers.duplicate?.(); break;
      case 't': handlers.texture?.(); break;
      case 'l': handlers.color?.(); break;
      case 'g': handlers.glow?.(); break;
      case 'h': handlers.hole?.(); break;
      case 'p': handlers.preview?.(); break;
      case 'delete':
      case 'backspace':
        handlers.delete?.();
        break;
    }
  });
}

export function toggleShortcutsHelp() {
  const existing = document.getElementById('shortcuts-modal');
  if (existing) {
    existing.classList.toggle('hidden');
    return;
  }

  const shortcuts = [
    ['Tools', [
      ['S', 'Select tool'],
      ['M', 'Move tool'],
      ['R', 'Rotate tool'],
      ['A', 'Scale tool'],
      ['Ctrl+M', 'Camera mode'],
    ]],
    ['Shapes', [
      ['C', 'Place Cylinder'],
      ['B', 'Place Ball'],
      ['U', 'Place Cube'],
      ['O', 'Place Cone'],
      ['Shift+D', 'Draw freeform shape'],
    ]],
    ['Object Actions', [
      ['Del / Backspace', 'Delete selected'],
      ['D', 'Duplicate selected'],
      ['T', 'Open texture gallery'],
      ['L', 'Open color picker'],
      ['G', 'Toggle glow'],
      ['H', 'Hole mode (CSG subtract)'],
    ]],
    ['History', [
      ['Ctrl+Z', 'Undo'],
      ['Ctrl+Shift+Z', 'Redo'],
      ['Shift+H', 'Open history panel'],
    ]],
    ['File & View', [
      ['P', 'Preview mode'],
      ['Ctrl+S', 'Save project'],
      ['Ctrl+O', 'Open project'],
      ['Ctrl+E', 'Export GLB'],
      ['Ctrl+Q', 'Toggle theme'],
      ['Shift+F', 'Floor color'],
      ['Shift+W', 'Wall color'],
    ]],
    ['Transform (with object selected)', [
      ['Arrow keys', 'Move / Rotate / Scale (X/Y)'],
      ['Shift+Arrows', 'Z-axis move / rotate / scale'],
      ['Ctrl+drag', 'Uniform scale (in Scale mode)'],
      ['Shift+drag', 'Z-axis in Move / Rotate / Scale'],
    ]],
    ['General', [
      ['?', 'Show this help'],
      ['Escape', 'Exit preview mode'],
      ['Right-click drag', 'Orbit camera (always)'],
      ['Scroll', 'Zoom (always)'],
      ['Middle-click drag', 'Pan camera (always)'],
    ]],
  ];

  const modal = document.createElement('div');
  modal.id = 'shortcuts-modal';
  modal.className = 'modal';

  const content = document.createElement('div');
  content.className = 'modal-content shortcuts-content';

  const header = document.createElement('div');
  header.className = 'modal-header';
  header.innerHTML = '<h3>Keyboard Shortcuts</h3><button class="modal-close">&times;</button>';
  header.querySelector('.modal-close').addEventListener('click', () => modal.classList.add('hidden'));
  content.appendChild(header);

  const body = document.createElement('div');
  body.className = 'shortcuts-body';

  for (const [group, keys] of shortcuts) {
    const section = document.createElement('div');
    section.className = 'shortcuts-section';
    const title = document.createElement('h4');
    title.className = 'shortcuts-group-title';
    title.textContent = group;
    section.appendChild(title);

    for (const [key, desc] of keys) {
      const row = document.createElement('div');
      row.className = 'shortcuts-row';
      const kbd = document.createElement('span');
      kbd.className = 'shortcuts-key';
      kbd.textContent = key;
      const label = document.createElement('span');
      label.className = 'shortcuts-desc';
      label.textContent = desc;
      row.appendChild(kbd);
      row.appendChild(label);
      section.appendChild(row);
    }

    body.appendChild(section);
  }

  content.appendChild(body);
  modal.appendChild(content);

  modal.addEventListener('click', (e) => {
    if (e.target === modal) modal.classList.add('hidden');
  });

  document.body.appendChild(modal);
}
