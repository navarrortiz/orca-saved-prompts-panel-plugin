import { createBridge } from './bridge.js';
import { createOrcaClient } from './orca.js';
import { createView } from './view.js';
import { createPanelChannel, readPanelData } from '../sdk/panel.js';
import { ACTION } from '../shared/protocol.js';
import { describeContext, describeError, describeTerminals, filterPrompts, toTerminalText, validateSend } from './lib/format.js';

// Composition root + controller: owns state, turns view intents into host calls.
const orca = createOrcaClient(createBridge(window));
const view = createView(document);

// __PROMPTS__ is inlined from prompts.json at build time (scripts/build.mjs).
const prompts = __PROMPTS__;
// Messaging SDK (AGENTS.md "Messaging SDK"): __RPC_PATH__ = absolute path of dist/rpc.mjs (build-time);
// the data (terminal titles + carrier ids) is what the worker patched into this file.
const data = readPanelData(document);
const channel = createPanelChannel({ orca, cliPath: __RPC_PATH__, data });

let state = { summary: 'Cargando…', query: '', visible: prompts, status: '', busy: false };
const setState = (patch) => view.render((state = { ...state, ...patch }));

async function run(task) {
  setState({ busy: true });
  try {
    setState({ status: (await task()) ?? '' });
  } catch (error) {
    setState({ status: describeError(error) });
  } finally {
    setState({ busy: false });
  }
}

const refresh = () =>
  run(async () => {
    setState({ summary: describeContext(await orca.readContext()) });
  });

view.onRefresh(refresh);

// Worker actions through the SDK carrier, no popup. No carrier in the focused worktree yet (worker
// not running, or worktree focused < 15 s ago): say so; the palette commands always work.
const sendAction = (action, done) =>
  run(async () => {
    const { sent, reason } = await channel.send(action, {});
    if (sent) return done;
    return reason === 'rejected' ? 'La terminal portadora rechazó la petición' : 'Worker sin arrancar: abre la paleta → "Saved Prompts: Editar prompts" (lo arranca) y reintenta en unos segundos';
  });
view.onNewPrompt(() => sendAction(ACTION.newPrompt, 'Abriendo prompts.json con un prompt nuevo…'));
view.onEditPrompts(() => sendAction(ACTION.editPrompts, 'Abriendo prompts.json…'));
view.onQuery((query) => setState({ query, visible: filterPrompts(prompts, query) }));

// Insert only, never press Enter: the user edits the prompt in the agent input first.
// Orca can't tell a plugin which terminal is focused: ask when there's more than one.
view.onInsert((prompt, point) =>
  run(async () => {
    // Read fresh on every click: the focused worktree and its terminals change under us.
    const context = await orca.readContext();
    setState({ summary: describeContext(context) });
    // Carriers are the worker's hidden shells: never paste a prompt there.
    const terminals = describeTerminals((context?.terminals ?? []).filter((t) => !channel.isCarrier(t.id)), data.titles);
    const terminalId = terminals.length > 1 ? await view.chooseTerminal(terminals, point) : terminals[0]?.id ?? '';
    if (terminalId === null) return ''; // popup dismissed
    const send = { terminalId, text: toTerminalText(prompt.text) };
    const invalid = validateSend(send);
    if (invalid) return invalid;
    const { accepted } = await orca.sendText(send.terminalId, send.text);
    return accepted ? `Insertado: ${prompt.title} — edítalo y pulsa Enter` : 'La terminal rechazó el texto';
  }),
);

refresh();

// Panels get no worktree-changed event, so poll quietly: no busy state, no status reset, and no
// re-render unless the summary changed (re-rendering rebuilds the rows under the cursor).
// ponytail: 3 s poll ≈ 3 of the 30 messages / 10 s budget; switch to an event if Orca adds one.
const syncSummary = () =>
  orca.readContext().then(
    (context) => {
      const summary = describeContext(context);
      if (summary !== state.summary) setState({ summary });
    },
    () => {}, // transient failures: the next tick retries
  );
setInterval(() => document.hidden || state.busy || syncSummary(), 3000);
window.addEventListener('focus', syncSummary);
