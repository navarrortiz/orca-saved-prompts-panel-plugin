# Saved Prompts — Orca plugin

A right-sidebar panel for [Orca](https://github.com/stablyai/orca) that keeps your reusable
prompts one click away and sends them straight into an agent terminal of the focused worktree.

- **Panel** (`book` icon): pick a prompt, pick a terminal, send.
- **Command palette**: `Saved Prompts: Nuevo prompt` adds a prompt, `Saved Prompts: Editar prompts`
  opens `prompts.json` in Orca's editor. Saving the file rebuilds the panel automatically.

> Orca's plugin system is **experimental** (pluginApi 1, tested on Orca 1.4.216). Things may break
> after an Orca upgrade.

## Requirements

- Orca ≥ 1.4.0
- Node.js ≥ 20
- pnpm

## Development install

1. Clone and build:

   ```bash
   git clone https://github.com/navarrortiz/orca-saved-prompts-panel-plugin.git
   cd orca-saved-prompts-panel-plugin
   pnpm install
   pnpm build          # → dist/ (the installable plugin)
   ```

   The first build creates your personal `prompts.json` (gitignored) from `prompts.default.json`.

2. In Orca: **Settings → Plugins → dev plugin paths**, add the absolute path to this repo's
   `dist/` folder and accept the consent dialog (workspace read, terminal send, notifications,
   trusted Node worker).

3. Open the right sidebar — the panel shows up under the `book` icon.

4. Live reload while developing:

   ```bash
   pnpm dev            # rebuilds dist/ on changes to src/, orca-plugin.json or prompts.json
   ```

   Orca watches dev paths and reloads the plugin by itself. If you change capabilities or the
   worker, Orca asks you to approve the new fingerprint in Settings.

Use a **dev plugin path**, not *Install plugin → Local folder*: local installs are copied and
integrity-hashed, so edits to `prompts.json` would never reach the panel.

## Scripts

| Command | What it does |
|---|---|
| `pnpm test` | Unit tests (`node:test`, no framework) |
| `pnpm build` | Bundle `src/` into single-file panel + worker in `dist/` |
| `pnpm dev` | `build` in watch mode |
| `pnpm check` | `test` + `build` |

## Prompts file

`prompts.json` is a plain array:

```json
[
  { "title": "Write tests", "text": "Write tests for the code you just changed." }
]
```

Prompts are baked into the panel at build time (the panel is sandboxed and can't read files).

## Project layout & internals

See [AGENTS.md](AGENTS.md) for the architecture, layering rules and everything discovered about
the Orca plugin API.
