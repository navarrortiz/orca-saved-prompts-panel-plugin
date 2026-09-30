import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createBridge } from '../src/panel/bridge.js';
import { describeContext, describeTerminals, filterPrompts, toTerminalText, validateSend } from '../src/panel/lib/format.js';
import { PANEL_MESSAGE } from '../src/shared/protocol.js';

function fakeWindow() {
  const listeners = [];
  const parent = { sent: [], postMessage: (msg) => parent.sent.push(msg) };
  return {
    parent,
    addEventListener: (_type, fn) => listeners.push(fn),
    reply: (data, source = parent) => listeners.forEach((fn) => fn({ source, data })),
  };
}

test('bridge resolves with the value of the matching result', async () => {
  const win = fakeWindow();
  const promise = createBridge(win).call('workspace.readContext');
  const { requestId, type } = win.parent.sent[0];
  assert.equal(type, PANEL_MESSAGE.request);
  win.reply({ type: PANEL_MESSAGE.result, requestId, ok: true, value: 42 });
  assert.equal(await promise, 42);
});

test('bridge rejects with the host error code', async () => {
  const win = fakeWindow();
  const promise = createBridge(win).call('terminal.sendText');
  win.reply({ type: PANEL_MESSAGE.result, requestId: win.parent.sent[0].requestId, ok: false, errorCode: 'rate_limited', error: 'slow down' });
  await assert.rejects(promise, { code: 'rate_limited', message: 'slow down' });
});

test('bridge ignores results from anything but the parent window', async () => {
  const win = fakeWindow();
  const promise = createBridge(win, { timeoutMs: 20 }).call('x');
  win.reply({ type: PANEL_MESSAGE.result, requestId: win.parent.sent[0].requestId, ok: true, value: 1 }, {});
  await assert.rejects(promise, { code: 'timeout' });
});

test('validateSend rejects a missing terminal and oversized text', () => {
  assert.equal(validateSend({ terminalId: '', text: 'ls' }), 'No hay terminal en el worktree activo');
  assert.match(validateSend({ terminalId: 't1', text: 'x'.repeat(4097) }), /4096/);
  assert.equal(validateSend({ terminalId: 't1', text: 'ls' }), null);
});

test('describeContext skips empty parts and distinguishes no worktree', () => {
  assert.equal(describeContext(null), 'Sin worktree enfocado');
  assert.equal(describeContext({ displayName: 'app', branch: 'main', terminals: [] }), 'app · main');
  assert.equal(describeContext({ displayName: 'app', branch: '', terminals: [] }), 'app');
});

test('filterPrompts matches title or text, case-insensitive', () => {
  const prompts = [{ title: 'Commit', text: 'git' }, { title: 'Tests', text: 'Write TESTS' }];
  assert.equal(filterPrompts(prompts, '  '), prompts);
  assert.deepEqual(filterPrompts(prompts, 'COMM'), [prompts[0]]);
  assert.deepEqual(filterPrompts(prompts, 'write'), [prompts[1]]);
});

test('toTerminalText wraps only multi-line prompts in bracketed paste', () => {
  assert.equal(toTerminalText('one line'), 'one line');
  assert.equal(toTerminalText('a\nb'), '\x1b[200~a\nb\x1b[201~');
});

test('describeTerminals labels by position with a short id hint', () => {
  assert.deepEqual(describeTerminals([{ id: 'term_141cc39f-5a2f' }, { id: 'x' }]), [
    { id: 'term_141cc39f-5a2f', label: 'Terminal 1', hint: '141cc39f' },
    { id: 'x', label: 'Terminal 2', hint: 'x' },
  ]);
});
