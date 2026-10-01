// Presentation only: reads/writes the DOM, exposes user intents as callbacks.
// No host calls, no business rules.
export function createView(doc) {
  const el = (id) => doc.getElementById(id);
  const ui = {
    summary: el('summary'),
    refresh: el('refresh'),
    newPrompt: el('new-prompt'),
    editPrompts: el('edit-prompts'),
    query: el('query'),
    list: el('list'),
    empty: el('empty'),
    status: el('status'),
    row: el('row-template'),
    menu: el('terminal-menu'),
    menuItems: el('terminal-menu-items'),
    menuItem: el('menu-item-template'),
  };
  let insertHandler = () => {};

  function renderRow(prompt, busy) {
    const item = ui.row.content.firstElementChild.cloneNode(true);
    const row = item.querySelector('.row');
    // textContent only: prompt text is user-authored.
    row.querySelector('.row-title').textContent = prompt.title;
    row.querySelector('.row-preview').textContent = prompt.text;
    row.title = prompt.text;
    row.disabled = busy;
    // Pass a point, not the row: the next render replaces the row before the popup opens.
    // Mouse clicks open the popup at the pointer (like Orca's context menus); keyboard ones under the row.
    row.addEventListener('click', (event) => {
      const box = row.getBoundingClientRect();
      insertHandler(prompt, event.detail ? { x: event.clientX, y: event.clientY } : { x: box.left, y: box.bottom });
    });
    return item;
  }

  return {
    render({ summary, visible, query, status, busy }) {
      ui.summary.textContent = summary;
      ui.status.textContent = status;
      ui.refresh.disabled = busy;
      ui.list.replaceChildren(...visible.map((p) => renderRow(p, busy)));
      ui.empty.textContent = visible.length ? '' : query ? 'Sin resultados' : 'Aún no hay prompts';
    },
    onRefresh: (fn) => ui.refresh.addEventListener('click', fn),
    onNewPrompt: (fn) => ui.newPrompt.addEventListener('click', fn),
    onEditPrompts: (fn) => ui.editPrompts.addEventListener('click', fn),
    onQuery: (fn) => ui.query.addEventListener('input', () => fn(ui.query.value)),
    onInsert: (fn) => (insertHandler = fn),

    /** Popup at viewport `point`; resolves the picked terminal id, or null if dismissed. */
    chooseTerminal(terminals, point) {
      return new Promise((resolve) => {
        const close = (id) => {
          ui.menu.hidden = true;
          doc.removeEventListener('pointerdown', onOutside, true);
          doc.removeEventListener('keydown', onKey, true);
          resolve(id);
        };
        const onOutside = (event) => ui.menu.contains(event.target) || close(null);
        const onKey = (event) => event.key === 'Escape' && close(null);

        ui.menuItems.replaceChildren(
          ...terminals.map(({ id, label, hint }) => {
            const item = ui.menuItem.content.firstElementChild.cloneNode(true);
            item.querySelector('.menu-item-label').textContent = label;
            item.querySelector('.menu-item-hint').textContent = hint;
            item.addEventListener('click', () => close(id));
            return item;
          }),
        );
        ui.menu.hidden = false;
        // Keep it inside the panel: clamp right, flip above the point when it would overflow below.
        const win = doc.defaultView;
        const { width, height } = ui.menu.getBoundingClientRect();
        const x = Math.max(4, Math.min(point.x, win.innerWidth - width - 4));
        const y = point.y + height > win.innerHeight - 4 ? Math.max(4, point.y - height) : point.y;
        ui.menu.style.left = `${x + win.scrollX}px`;
        ui.menu.style.top = `${y + win.scrollY}px`;
        ui.menuItems.firstElementChild.focus();
        doc.addEventListener('pointerdown', onOutside, true);
        doc.addEventListener('keydown', onKey, true);
      });
    },
  };
}
