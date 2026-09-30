import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { NEW_PROMPT, debounce, editPrompts, newPrompt, reportErrors } from '../src/worker/handlers.js';
import activate, { deactivate } from '../src/worker/main.js';
import { orcaCliCandidates } from '../src/worker/orca.js';

function fakeDeps(prompts = [{ title: 'a', text: 'b' }]) {
  const calls = [];
  return {
    calls,
    readPrompts: async () => prompts,
    writePrompts: async (list) => void calls.push(['write', list]),
    ensurePrompts: async () => void calls.push(['ensure']),
    openInEditor: async () => void calls.push(['open']),
  };
}

test('newPrompt appends a placeholder, then opens the file', async () => {
  const deps = fakeDeps();
  assert.deepEqual(await newPrompt(deps), { count: 2 });
  assert.deepEqual(deps.calls, [['write', [{ title: 'a', text: 'b' }, NEW_PROMPT]], ['open']]);
});

test('reportErrors notifies and rethrows', async () => {
  const notes = [];
  const notify = async (title, body) => void notes.push(body);
  await assert.rejects(reportErrors(notify, async () => { throw new Error('boom'); }), /boom/);
  assert.deepEqual(notes, ['boom']);
});

test('activate registers every worker command in the manifest', async () => {
  const manifest = JSON.parse(readFileSync(new URL('../orca-plugin.json', import.meta.url), 'utf8'));
  const commands = new Map();
  await activate({ commands: { register: (id, fn) => commands.set(id, fn) }, host: { call: async () => {} }, log: () => {} }, '/tmp/saved-prompts-test-none.json', '/tmp/saved-prompts-test-none.html');
  deactivate();
  const declared = manifest.contributes.commands.filter((c) => !c.action).map((c) => c.id);
  assert.deepEqual([...commands.keys()].sort(), declared.sort());
});

test('debounce collapses a burst of calls into one', async () => {
  let calls = 0;
  const fn = debounce(() => calls++, 10);
  fn(); fn(); fn();
  await new Promise((r) => setTimeout(r, 30));
  assert.equal(calls, 1);
});

test('editPrompts creates the file if missing before opening it', async () => {
  const deps = fakeDeps();
  await editPrompts(deps);
  assert.deepEqual(deps.calls, [['ensure'], ['open']]);
});

test('orcaCliCandidates finds the CLI bundled with Orca on each platform', () => {
  assert.deepEqual(orcaCliCandidates('win32', 'C:\\Program Files\\Orca\\Orca.exe'), ['orca', 'C:\\Program Files\\Orca\\resources\\bin\\orca.exe']);
  assert.deepEqual(orcaCliCandidates('darwin', '/Applications/Orca.app/Contents/MacOS/Orca'), ['orca', '/Applications/Orca.app/Contents/Resources/bin/orca']);
  assert.deepEqual(orcaCliCandidates('linux', '/opt/orca/orca-ide'), ['orca', '/opt/orca/resources/bin/orca-ide']);
});
