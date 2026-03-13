import * as THREE from 'three';

const textureLoader = new THREE.TextureLoader();

// All textures — image files from Poly Haven (CC0)
const textureDefinitions = [
  { name: 'Wood', file: 'textures/wood.jpg' },
  { name: 'Grass', file: 'textures/grass.jpg' },
  { name: 'Stone', file: 'textures/stone.jpg' },
  { name: 'Metal', file: 'textures/metal.jpg' },
  { name: 'Brick', file: 'textures/brick.jpg' },
  { name: 'Concrete', file: 'textures/concrete.jpg' },
  { name: 'Sand', file: 'textures/sand.jpg' },
  { name: 'Fabric', file: 'textures/fabric.jpg' },
  { name: 'Brown Leather', file: 'textures/leather_brown.jpg' },
  { name: 'White Leather', file: 'textures/leather_white.jpg' },
  { name: 'Terrazzo', file: 'textures/terrazzo.jpg' },
  { name: 'Plaster', file: 'textures/plaster.jpg' },
  { name: 'Cracked Plaster', file: 'textures/cracked_plaster.jpg' },
  { name: 'Asphalt', file: 'textures/asphalt.jpg' },
  { name: 'Snow', file: 'textures/snow.jpg' },
  { name: 'Rock', file: 'textures/rock.jpg' },
  { name: 'Mossy Rock', file: 'textures/mossy_rock.jpg' },
  { name: 'Mossy Wall', file: 'textures/mossy_wall.jpg' },
  { name: 'Rocky Terrain', file: 'textures/rocky_terrain.jpg' },
  { name: 'Gravel', file: 'textures/gravel.jpg' },
  { name: 'Cobblestone', file: 'textures/cobblestone.jpg' },
  { name: 'Slate', file: 'textures/slate.jpg' },
  { name: 'Granite', file: 'textures/granite.jpg' },
  { name: 'Red Sandstone', file: 'textures/red_sandstone.jpg' },
  { name: 'Rusty Metal', file: 'textures/rusty_metal.jpg' },
  { name: 'Roof Tiles', file: 'textures/roof_tiles.jpg' },
  { name: 'Bark', file: 'textures/bark.jpg' },
  { name: 'Cliff', file: 'textures/cliff.jpg' },
];

const textureCache = new Map();

export function getTexture(name) {
  if (textureCache.has(name)) return textureCache.get(name);

  const def = textureDefinitions.find(d => d.name === name);
  if (!def) return null;

  const texture = textureLoader.load(def.file);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.name = name;
  textureCache.set(name, texture);
  return texture;
}

export function buildTextureGallery(onSelect) {
  const grid = document.getElementById('texture-grid');
  grid.innerHTML = '';

  // Remove texture option
  const removeItem = document.createElement('div');
  removeItem.className = 'texture-item remove-texture';
  removeItem.innerHTML = '<span>No Texture</span>';
  removeItem.addEventListener('click', () => onSelect(null));
  grid.appendChild(removeItem);

  textureDefinitions.forEach(def => {
    const item = document.createElement('div');
    item.className = 'texture-item';

    const img = document.createElement('img');
    img.src = def.file;
    img.alt = def.name;
    img.loading = 'lazy';
    item.appendChild(img);

    const label = document.createElement('div');
    label.className = 'texture-name';
    label.textContent = def.name;
    item.appendChild(label);

    item.addEventListener('click', () => onSelect(def.name));
    grid.appendChild(item);
  });
}
