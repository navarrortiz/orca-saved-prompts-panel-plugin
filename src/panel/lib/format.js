import { LIMITS } from '../../shared/protocol.js';

// Pure functions: no DOM, no bridge. Everything here is unit-tested.

const PASTE_START = '\x1b[200~';
const PASTE_END = '\x1b[201~';

/** "worktree · branch"; skips the branch when empty (a non-git folder has none). */
export function describeContext(context) {
  if (!context) return 'Sin worktree enfocado';
  return [context.displayName, context.branch].filter(Boolean).join(' · ');
}

/** Case-insensitive match on title or text; empty query keeps everything. */
export function filterPrompts(prompts, query) {
  const q = query.trim().toLowerCase();
  if (!q) return prompts;
  return prompts.filter((p) => p.title.toLowerCase().includes(q) || p.text.toLowerCase().includes(q));
}

/**
 * terminal.sendText writes raw bytes to the PTY, so a bare newline would submit a
 * multi-line prompt line by line. Bracketed paste makes the agent treat it as one block.
 */
export function toTerminalText(text) {
  return text.includes('\n') ? `${PASTE_START}${text}${PASTE_END}` : text;
}

/**
 * The plugin API gives only terminal ids, in pane-layout order, with no focus flag or tab title.
 * Best label available: position + a short id so two picks can be told apart.
 */
export function describeTerminals(terminals) {
  return terminals.map(({ id }, i) => ({ id, label: `Terminal ${i + 1}`, hint: id.replace(/^term_/, '').slice(0, 8) }));
}

/** @returns {string | null} error message, or null when the input is sendable */
export function validateSend({ terminalId, text }) {
  if (!terminalId) return 'No hay terminal en el worktree activo';
  if (!text.trim()) return 'Prompt vacío';
  if (text.length > LIMITS.textMax) return `Supera ${LIMITS.textMax} caracteres`;
  return null;
}

export function describeError(error) {
  return error?.code ? `${error.code}: ${error.message}` : String(error?.message ?? error);
}
