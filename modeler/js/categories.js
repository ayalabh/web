// Category expand/collapse system
// Each category tracks the last-used button. When collapsed, only that button is shown.

const lastUsed = {}; // category name -> button element

export function initCategories() {
  document.querySelectorAll('.toolbar-category').forEach(cat => {
    const name = cat.dataset.category;
    const header = cat.querySelector('.category-header');
    const more = cat.querySelector('.category-more');
    const buttons = cat.querySelector('.category-buttons');

    // Set first button as default "last used"
    const firstBtn = buttons.querySelector('.tool-btn');
    if (firstBtn) {
      firstBtn.classList.add('cat-last-used');
      lastUsed[name] = firstBtn;
    }

    // Click header: toggle expand/collapse
    header.addEventListener('click', () => {
      cat.classList.toggle('collapsed');
    });

    // Click "...": expand
    more.addEventListener('click', () => {
      cat.classList.remove('collapsed');
    });

    // Track last-used on any button click in this category
    buttons.querySelectorAll('.tool-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        markLastUsed(name, btn);
      });
    });
  });
}

function markLastUsed(categoryName, btn) {
  const prev = lastUsed[categoryName];
  if (prev) prev.classList.remove('cat-last-used');
  btn.classList.add('cat-last-used');
  lastUsed[categoryName] = btn;
}

// Allow external code to mark a button as last-used (e.g. when keyboard shortcut triggers it)
export function setLastUsed(btn) {
  const cat = btn.closest('.toolbar-category');
  if (!cat) return;
  markLastUsed(cat.dataset.category, btn);
}
