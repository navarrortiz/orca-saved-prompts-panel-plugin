// Builds dist/ = the folder you add in Orca as a dev plugin path (Settings → Plugins).
//
// Convention: a panel with `"entry": "<name>.html"` is built from src/<name>/
// (index.html + styles.css + main.js). The worker (`"main": "<file>.mjs"`) is
// built from src/worker/main.js.
import { build } from 'esbuild';
import { LIMITS } from '../src/shared/protocol.js';
import { seedPrompts } from '../src/worker/orca.js';
import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const dist = new URL('dist/', root);
const read = (path) => readFile(new URL(path, root), 'utf8');
const manifest = JSON.parse(await read('orca-plugin.json'));
const pluginKey = `${manifest.publisher}.${manifest.id}`;
// dist/rpc.mjs: panel → worker messenger typed into a terminal (AGENTS.md "Messaging SDK").
const RPC_CLI = 'rpc.mjs';

checkManifest(manifest);
// prompts.json is personal (gitignored); a fresh clone starts from prompts.default.json.
await seedPrompts(fileURLToPath(new URL('prompts.json', root)));
const prompts = loadPrompts(JSON.parse(await read('prompts.json')));
// Keep the directory (Orca watches it as a dev plugin path) and only touch files whose content
// changed: every write reloads the panel/plugin, so a rebuild with nothing new must be a no-op.
await mkdir(dist, { recursive: true });
const written = new Set();
async function emit(file, content) {
  written.add(file);
  const url = new URL(file, dist);
  if ((await readFile(url, 'utf8').catch(() => null)) !== content) await writeFile(url, content);
}

for (const panel of manifest.contributes?.panels ?? []) {
  const name = panel.entry.replace(/\.html$/, '');
  const [html, css, js] = await Promise.all([
    read(`src/${name}/index.html`),
    read(`src/${name}/styles.css`),
    bundle({ entryPoints: [`src/${name}/main.js`], format: 'iife', platform: 'browser', define: { __PROMPTS__: JSON.stringify(prompts), __RPC_PATH__: JSON.stringify(fileURLToPath(new URL(RPC_CLI, dist))) } }),
  ]);
  // Function replacers: bundle text may contain `$&`-style sequences.
  const page = html
    .replace('<!-- @inline-styles -->', () => `<style>\n${css}</style>`)
    .replace('<!-- @inline-script -->', () => `<script>\n${js.replace(/<\/script/gi, '<\\/script')}</script>`);
  // Carry over what the worker patched in (terminal titles, carriers): resetting it = two reloads.
  const old = await readFile(new URL(panel.entry, dist), 'utf8').catch(() => '');
  const data = old.match(/<script id="panel-data" type="application\/json">([^<]*)<\/script>/)?.[1];
  await emit(panel.entry, data ? page.replace('<script id="panel-data" type="application/json">{}</script>', () => `<script id="panel-data" type="application/json">${data}</script>`) : page);
}

if (manifest.main) {
  await emit(
    manifest.main,
    // ponytail: absolute path baked in = this machine's checkout; fine for a personal plugin.
    await bundle({ entryPoints: ['src/worker/main.js'], format: 'esm', platform: 'node', define: { __PROMPTS_PATH__: JSON.stringify(fileURLToPath(new URL('prompts.json', root))) } }),
  );
}

await emit(RPC_CLI, await bundle({ entryPoints: ['src/sdk/cli.js'], format: 'esm', platform: 'node', define: { __PLUGIN_KEY__: JSON.stringify(pluginKey) } }));
await emit('orca-plugin.json', await read('orca-plugin.json'));
for (const f of await readdir(dist)) if (!written.has(f)) await rm(new URL(f, dist), { recursive: true, force: true });
console.log(`built ${pluginKey}@${manifest.version} → ${fileURLToPath(dist)}`);

async function bundle(options) {
  const result = await build({ ...options, absWorkingDir: fileURLToPath(root), bundle: true, write: false, target: 'es2022' });
  return result.outputFiles[0].text;
}

// prompts.json = [{ title, text }]. The panel has no storage of its own, so the file is the
// store and is baked into the bundle; `pnpm dev` rebuilds on save and Orca reloads the panel.
function loadPrompts(list) {
  const errors = [];
  if (!Array.isArray(list)) errors.push('must be an array of { title, text }');
  else list.forEach((p, i) => {
    if (typeof p?.title !== 'string' || !p.title.trim()) errors.push(`[${i}].title must be a non-empty string`);
    if (typeof p?.text !== 'string' || !p.text.trim()) errors.push(`[${i}].text must be a non-empty string`);
    // 12 = bracketed-paste wrapper added to multi-line prompts (see toTerminalText).
    else if (p.text.length > LIMITS.textMax - 12) errors.push(`[${i}].text exceeds ${LIMITS.textMax - 12} characters`);
  });
  if (errors.length) {
    console.error(`prompts.json:\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
  return list.map(({ title, text }) => ({ title, text }));
}

// ponytail: a fast pre-install subset of Orca's zod schema, not the full thing.
// Orca re-validates on install; see AGENTS.md "Validate against Orca's real schema".
function checkManifest(m) {
  const errors = [];
  const kebab = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  const CAPABILITIES = ['workspace:read', 'terminal:send', 'notifications:show', 'storage', 'secrets', 'events:subscribe', 'settings:own'];
  const EVENTS = ['worktree.created', 'worktree.removed', 'agent.status.changed'];
  // Renderer map in Orca 1.4.216 (App-*.js); names are matched without dashes, anything else renders as `plug`.
  const ICONS = 'activity barchart3 bell blocks book bot bug calendar cloud code database filetext flag folder gauge globe hammer layers lightbulb package plug puzzle rocket star terminal wrench zap'.split(' ');
  const c = m.contributes ?? {};

  for (const key of ['id', 'publisher']) if (!kebab.test(m[key] ?? '')) errors.push(`${key} must be kebab-case`);
  if (m.publisher === 'stablyai') errors.push('publisher "stablyai" is reserved');
  if (!/^>=\d+\.\d+\.\d+$/.test(m.engines?.orca ?? '')) errors.push('engines.orca must be ">=x.y.z"');
  for (const cap of m.capabilities ?? []) if (!CAPABILITIES.includes(cap.kind)) errors.push(`unknown capability ${cap.kind}`);
  for (const p of c.panels ?? []) if (!kebab.test(p.id) || !p.entry?.endsWith('.html')) errors.push(`panel ${p.id}: kebab id + .html entry`);
  for (const p of c.panels ?? []) if (p.icon && !ICONS.includes(p.icon.replaceAll('-', '').toLowerCase())) errors.push(`panel ${p.id}: unknown icon "${p.icon}"`);
  for (const e of c.events ?? []) if (!EVENTS.includes(e.on)) errors.push(`unknown event ${e.on}`);
  if ((c.events ?? []).length && !m.main) errors.push('events require "main"');
  if ((c.events ?? []).length && !(m.capabilities ?? []).some((x) => x.kind === 'events:subscribe')) errors.push('events require events:subscribe');
  if ((c.commands ?? []).some((cmd) => !cmd.action) && !m.main) errors.push('worker commands (no "action") require "main"');

  if (errors.length) {
    console.error(`orca-plugin.json:\n  - ${errors.join('\n  - ')}`);
    process.exit(1);
  }
}
