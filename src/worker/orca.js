import { execFile } from 'node:child_process';
import { constants, watch } from 'node:fs';
import { copyFile, readFile, stat, writeFile } from 'node:fs/promises';
import path, { basename, dirname, join } from 'node:path';
import { promisify } from 'node:util';
import { HOST_METHOD, LIMITS } from '../shared/protocol.js';

const run = promisify(execFile);

const CLI_NAME = { win32: 'orca.exe', darwin: 'orca', linux: 'orca-ide' };

/**
 * `orca` on PATH first; otherwise the CLI Orca ships in its own resources/bin (the worker runs on
 * Orca's binary, so execPath locates it). Paths from Orca 1.4.216 (main bundle, CLI install logic).
 */
export function orcaCliCandidates(platform = process.platform, execPath = process.execPath, resourcesPath = process.resourcesPath) {
  const p = platform === 'win32' ? path.win32 : path.posix;
  const resources = resourcesPath ?? p.join(p.dirname(execPath), platform === 'darwin' ? '../Resources' : 'resources');
  return ['orca', p.join(resources, 'bin', CLI_NAME[platform] ?? 'orca')];
}

/**
 * First run on a fresh clone: create prompts.json from the shared prompts.default.json.
 * Never overwrites; no default either = start empty. Also used by scripts/build.mjs.
 */
export async function seedPrompts(promptsPath) {
  const defaults = join(dirname(promptsPath), 'prompts.default.json');
  await copyFile(defaults, promptsPath, constants.COPYFILE_EXCL).catch(async (error) => {
    if (error.code === 'EEXIST') return;
    if (error.code !== 'ENOENT') throw error;
    await writeFile(promptsPath, '[]\n', { flag: 'wx' }).catch((e) => {
      if (e.code !== 'EEXIST') throw e;
    });
  });
}

// Worker deps: host API + the prompts file. Handlers depend on this shape only.
export function createDeps(host, promptsPath, panelPath) {
  // The worker runs as Electron-as-Node; the orca CLI is the same binary and must not inherit that flag.
  const { ELECTRON_RUN_AS_NODE, ...env } = process.env;
  const root = dirname(promptsPath);
  const args = ['file', 'open', promptsPath, '--worktree', `path:${root}`];

  return {
    notify: (title, body) =>
      host.call(HOST_METHOD.notify, { title: title.slice(0, LIMITS.notifyTitleMax), body: body.slice(0, LIMITS.notifyBodyMax) }),
    readPrompts: async () => {
      await seedPrompts(promptsPath);
      return JSON.parse(await readFile(promptsPath, 'utf8'));
    },
    ensurePrompts: () => seedPrompts(promptsPath),
    writePrompts: (prompts) => writeFile(promptsPath, `${JSON.stringify(prompts, null, 2)}\n`),
    // Same build as `pnpm build`; process.execPath is Electron here, so run it as Node.
    rebuild: () =>
      run(process.execPath, [join(root, 'scripts/build.mjs')], {
        cwd: root,
        env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' },
        timeout: 60_000,
      }).catch((error) => {
        throw new Error(error.stderr?.trim() || error.message);
      }),
    /** prompts.json saved after the panel was last built (e.g. while the worker was reaped). */
    async isPanelStale() {
      const mtime = (path) => stat(path).then((s) => s.mtimeMs, () => null);
      const [prompts, panel] = await Promise.all([mtime(promptsPath), mtime(panelPath)]);
      return prompts !== null && (panel === null || prompts > panel);
    },
    // Any host call counts as worker activity for Orca's idle reaper.
    heartbeat: () => host.call(HOST_METHOD.readContext, {}),
    // Watch the folder, not the file: editors that save via rename would orphan a file watcher.
    watchPrompts(onChange) {
      const watcher = watch(root, (_event, file) => file === basename(promptsPath) && onChange());
      return () => watcher.close();
    },
    async openInEditor() {
      let lastError;
      for (const cli of orcaCliCandidates()) {
        try {
          return await run(cli, args, { env, timeout: 15_000 });
        } catch (error) {
          lastError = error;
          if (error.code !== 'ENOENT') break; // CLI found but failed: don't mask the real error
        }
      }
      throw new Error(`No se pudo abrir ${promptsPath}: ${lastError.stderr?.trim() || lastError.message}`);
    },
  };
}
