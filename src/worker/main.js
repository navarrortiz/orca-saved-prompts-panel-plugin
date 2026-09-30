import { fileURLToPath } from 'node:url';
import { COMMAND } from '../shared/protocol.js';
import { createDeps } from './orca.js';
import { debounce, editPrompts, newPrompt, reportErrors } from './handlers.js';

let stopWatching;
let heartbeatTimer;

// Orca reaps a worker after 5 min without IPC activity (idleReapMs, Orca 1.4.216), which would
// kill the prompts.json watcher. ponytail: ping every 4 min; drop it if Orca adds long-lived workers.
const HEARTBEAT_MS = 4 * 60_000;

// Worker entry: Orca forks a Node process, imports this module and calls the
// default export once with ctx = { commands, events, host, grantedCapabilities, log }.
// Keep this file wiring-only; logic lives in handlers.js.
// __PROMPTS_PATH__ = absolute path of the repo's prompts.json, inlined by scripts/build.mjs.
// panel.html sits next to this bundle in dist/.
export default async function activate(
  ctx,
  promptsPath = __PROMPTS_PATH__,
  panelPath = fileURLToPath(new URL('panel.html', import.meta.url)),
) {
  const deps = createDeps(ctx.host, promptsPath, panelPath);
  ctx.commands.register(COMMAND.newPrompt, () => reportErrors(deps.notify, () => newPrompt(deps)));
  ctx.commands.register(COMMAND.editPrompts, () => reportErrors(deps.notify, () => editPrompts(deps)));

  // The panel bakes prompts.json in at build time: rebuild dist/ on every save and Orca
  // (dev plugin path) reloads the panel. Never let a failed build reject: that kills the worker.
  const rebuild = () => reportErrors(deps.notify, deps.rebuild).catch((error) => ctx.log(`rebuild failed: ${error.message}`));
  stopWatching = deps.watchPrompts(debounce(rebuild, 300));
  heartbeatTimer = setInterval(() => deps.heartbeat().catch(() => {}), HEARTBEAT_MS);
  // Orca only starts the worker on demand: catch up on edits made while it wasn't running.
  // Not awaited: commands must register before activate resolves, a build takes a second.
  deps.isPanelStale().then((stale) => stale && rebuild());
  ctx.log(`watching ${promptsPath}`);
}

export function deactivate() {
  stopWatching?.();
  clearInterval(heartbeatTimer);
}
