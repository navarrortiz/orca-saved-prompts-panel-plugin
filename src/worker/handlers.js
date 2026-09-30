// Business logic of the worker. Takes plain deps (fs + editor + notify), returns
// plain values — no ctx, no IPC, so it runs under node:test with fakes.

export const NEW_PROMPT = { title: 'Nuevo prompt', text: 'Escribe aquí el prompt' };

export async function editPrompts({ ensurePrompts, openInEditor }) {
  await ensurePrompts();
  await openInEditor();
  return { opened: true };
}

/** Appends a placeholder entry, then opens the file so the user fills it in. */
export async function newPrompt({ readPrompts, writePrompts, openInEditor }) {
  const prompts = await readPrompts();
  await writePrompts([...prompts, NEW_PROMPT]);
  await openInEditor();
  return { count: prompts.length + 1 };
}

/** Editors fire several fs events per save; run fn once they settle. */
export function debounce(fn, ms) {
  let timer;
  return () => {
    clearTimeout(timer);
    timer = setTimeout(fn, ms);
  };
}

/** Commands have no UI of their own: surface failures as a notification, then rethrow. */
export async function reportErrors(notify, task) {
  try {
    return await task();
  } catch (error) {
    await notify('Saved Prompts', String(error?.message ?? error)).catch(() => {});
    throw error;
  }
}
