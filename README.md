# Prompt Weaver Local

A local, Windows-first desktop tool for prompt-combinator diffusion generation.

## What it does

- Runs fully locally: a FastAPI backend drives the shared `diffusion-lora-runtime` package, and an Electron + React desktop UI built with Fluent UI 2 talks to it.
- Keeps the current diffusion model and its loaded LoRAs in memory between generations.
- Lets you pick:
  - one diffusion model
  - N LoRAs
  - width / height / steps / CFG
  - a prompt seed and an image seed, each with its own behavior after each generation
- Builds the final positive prompt by choosing one sub-prompt per active category.
- Supports forbidden associations between sub-prompts, categories and tags.
- Supports categories that are disabled by default and only become active when a selected sub-prompt contains their activation text.
- Saves every generation as an image plus an adjacent JSON metadata file in `<data dir>/output`.
- Keeps everything else in the data directory too: frontend state (`<data dir>/stores`), the app-managed trash (`<data dir>/trash`) and the legacy `app_state.json` / `library.json`.

The data directory is `D:\Anything\storage\prompt-weaver-local-storage` on Windows, or `<repo>/.prompt_weaver_local_data` on other systems. Set the `PROMPT_WEAVER_DATA_DIR` environment variable to use a different one. The backend owns this layout in `backend/app/settings.py`.

## Current behavior

### Workspace

- The workspace holds movable, resizable floating windows: the panes (Image, Output browser, Generation, Used sub-prompts) and one card per prompt category. Every window shares one stacking order; clicking a window brings it to the front.
- Drag a window by its header and resize it with the bottom-right grip. Both handles also work from the keyboard: focus them and use the arrow keys (8 px per press, 40 px with `Shift`).
- Each window header has a "Send to back" button; panes also have a Close button.
- The app bar at the top has Add category, Reorganize categories, one toggle per pane to show or hide it, the visibility mode, and Undo. Tooltips show the keyboard shortcuts.
- Window positions, sizes, stacking order and closed panes are saved. Layouts saved by older versions (`panel-layouts-store` + `workspace-z-index-store`) are migrated into `workspace-store` on first start and left untouched.
- `Ctrl+H` cycles visibility between everything, categories only, and panes only.
- `Ctrl+O` sorts the categories by priority, then name, renumbers their priorities and arranges their cards in a grid.
- The UI follows Microsoft Fluent 2 (Fluent UI React v9) and switches between light and dark to match the OS setting, live.

### Models and LoRAs

- Choose the model from a dropdown in the Generation pane.
- The LoRA list has one checkbox per LoRA for the default selection, plus Clear, Add files and Add folder. LoRAs that a sub-prompt pulls in are marked "Prompt-linked" and can be unlinked from every sub-prompt in one click. A summary shows the default-selected, prompt-linked and possibly active counts.
- Add models and LoRAs through Electron file and folder dialogs:
  - model files (`.safetensors`, `.ckpt`) or a Diffusers model directory
  - LoRA files (`.safetensors`, `.bin`, `.pt`, several at once) or LoRA directories
- The dialogs open in the last model folder or last LoRA folder you used. They need the desktop app; in a plain browser the app says so instead.
- Adding a model or LoRA whose path is already in the library reuses (and selects) the existing entry.
- The backend keeps the current model loaded and only reloads LoRAs when the set changes.
- A sub-prompt can pull in extra LoRAs (`extra_lora_ids`). Removing a LoRA from the library also unlinks it from every sub-prompt.
- The runtime resolves inline `<lora:name:weight>` tags against the ComfyUI `loras` folder and textual-inversion embeddings against the `embeddings` folder. See `DEFAULT_PROMPT_LORA_DIR` and `DEFAULT_PROMPT_EMBEDDING_DIR` in `backend/app/settings.py`.

### Prompt categories

- Each category is a card. In a card you can:
  - rename the category
  - set its priority
  - set an optional activation text
  - skip the whole category
  - add, edit inline, skip or delete sub-prompts
  - bulk-edit all of its sub-prompts as text (entries separated by a line containing only `|`; `Ctrl+Enter` applies, `Escape` cancels)
  - lock one sub-prompt so it is always chosen until you unlock it
  - delete the category (after a confirmation)
- Inline edits: `Enter` commits, `Shift+Enter` inserts a line break, `Escape` cancels, and leaving the field commits.
- The sub-prompts used by the output being viewed are highlighted in their cards, which scroll to them.
- A category with an activation text (comma-separated terms) is disabled by default. It only takes part when a sub-prompt selected before it (in generation order) contains one of the terms, ignoring case and extra whitespace.
- Forbidden associations take precedence over activation: a triggered category that would conflict is skipped.
- Categories and sub-prompts that cannot be selected (because of skips, locks, activation texts and forbidden associations) are shown as indirectly disabled automatically. The old `Ctrl+D` "compute indirectly disabled" command no longer exists.

### Forbidden associations

- You edit associations in the Used sub-prompts pane, which lists the sub-prompts used by the current output (each with a button copying its text). Click two endpoints to toggle an association between them. An endpoint is one of:
  - `P`: that exact sub-prompt
  - `C`: its whole category
  - a tag chip: any sub-prompt carrying that tag
- Rules from older versions, including "contains text" rules, still load.
- Exact sub-prompt matching ignores casing, whitespace and the order of comma-separated tags.
- Category cards highlight the sub-prompts forbidden together with the selected association source in red, or purple when a lock is involved.

### Seeds

- The prompt seed drives which sub-prompts are chosen. The image seed drives the diffusion. An empty seed field means a random seed.
- After each generation, each seed field follows its behavior:
  - `Fixed`
  - `Auto increment`
  - `Randomize`
  - `Per-category cycle (random restart)` (prompt seed only)

### Outputs

- Every generation is saved in `<data dir>/output` under a fixed-width 10-digit number: `0000000001.png` + `0000000001.json`.
- After a generation, the UI jumps to the newest output.
- The arrow keys move through the output history: left/up goes to the previous output, right/down to the next. They are left to the focused control when it uses them itself (text fields, window handles, menus, dropdowns, the app bar); click elsewhere to browse again. The Output browser pane offers First / Previous / Next / Last buttons.
- For the current output, the Output browser shows its number and position, image name, size, steps, CFG, seed, prompt seed, model and LoRAs; the Used sub-prompts pane lists each category with its chosen sub-prompt. "Copy prompt" (Output browser and Generation pane) copies the full prompt.
- Output ids come from file names only, so the list stays fast with thousands of outputs. Metadata and images are loaded by id through the backend API.

### Delete and undo

- Delete moves the image and its JSON into the app-managed trash folder, `<data dir>/trash`.
- `Ctrl+Z` (or Undo in the app bar) undoes, newest first:
  - a generation step: it goes back to the previous output and restores the seed inputs (the generated files stay on disk)
  - a deletion: it restores the files from the trash
- `Ctrl+Z` needs exactly that combination: `Ctrl+Shift+Z` does nothing. It is ignored while typing in a text field.

### Generation and progress

- `Ctrl+G` generates one image. `Ctrl+T` starts or stops continuous generation. Both also work while typing in a text field. The Generation pane has Generate, Continuous and Cancel buttons.
- A failed generation shows an error notification and stops continuous generation. LoRAs requested by the selection but missing from the library are skipped with a warning.
- The backend streams progress over the WebSocket `/ws/tasks`. The stages are loading the model, sampling (one update per diffusion step), saving, complete, error and cancelled. `GET /api/tasks` returns the latest event of every task. The Generation and Output browser panes show it as a progress bar.
- In the backend console, the first `Ctrl+C` cancels the running generation and then stops the server gracefully. A second `Ctrl+C` exits immediately.

### Keyboard shortcuts

All bindings are defined once, in `frontend/src/app/keymap.json`. The Electron "Shortcuts" menu is built from the entries flagged `menu: true`; `frontend/src/app/commands.ts` dispatches both the keys and the menu commands.

| Shortcut | Command |
| --- | --- |
| `Ctrl+G` | Generate |
| `Ctrl+T` | Toggle continuous generation |
| `Ctrl+H` | Cycle visibility (all / categories only / panes only) |
| `Ctrl+O` | Reorganize categories |
| `Ctrl+Z` | Undo |
| `←` / `↑`, `→` / `↓` | Previous / next output |

## Architecture

### Project layout

```text
prompt-weaver-local/
  config/
    defaults.json          dev host + ports (single source: launcher, backend, Vite, Electron)
    appConfig.cjs          backend URL for Node consumers (honors PROMPT_WEAVER_BACKEND_URL)
  backend/
    app/
      factory.py           create_app(paths, generator_factory, install_signal_handlers) + lifespan
      main.py              ASGI entry point (app = create_app())
      schemas.py           Pydantic API models: the only shared type definitions
      settings.py          data dir layout (AppPaths), PROMPT_WEAVER_DATA_DIR, shared config
      dependencies.py      ServicesDep (services from app.state, HTTP and WebSocket)
      openapi_export.py    dumps the OpenAPI document without a server
      routers/             one APIRouter per area, registered in routers/__init__.py (ROUTERS)
        health, bootstrap, outputs, generation, tasks, stores
      services/            domain logic and IO, constructed with injected paths
        container.py       build_services -> AppServices
        json_files.py      crash-resilient JSON files (.new/.old sidecars)
        legacy_state.py    app_state.json / library.json (read-only seeds)
        outputs.py         output ids, metadata, images, trash/restore
        persisted_stores.py  frontend store files, legacy Electron formats included
        task_hub.py        latest event per task + WebSocket fan-out
        generation.py      generation orchestration, GeneratorPort
        runtime_adapter.py the only importer of diffusion_lora_runtime (loaded lazily)
        signals.py         Ctrl+C cancels, second Ctrl+C exits
    openapi.json           committed OpenAPI snapshot
    tests/                 pytest + TestClient on temp dirs with a fake generator
    run_backend.py
  frontend/
    electron/              main.cjs (backend start, window, dialogs), preload.cjs (bridge), ipcChannels.cjs,
                           shortcutMenu.cjs (menu from keymap.json), windowTheme.cjs (Fluent background) + tests
    scripts/               apiTypes.mjs + generate-api-types.mjs (npm run gen:api)
    src/
      api/                 schema.gen.ts (generated), types.ts, config.ts (URLs), client.ts, taskSocket.ts
      persistence/         persist.ts (the one persistence mechanism), storeBackend.ts, storeNames.ts
      domain/              pure logic: text, guards, categories, forbiddenRules, reachability, promptEngine,
                           seeds, library, loraSelection, generationRequest, outputs, layout, legacyImport, paths
      stores/              one zustand store per domain (see "Frontend stores" below)
      features/            thin Fluent views per feature (categories, forbidden, generation, library, outputs)
      workspace/           Workspace shell, FloatingPane, app bar, paneRegistry.tsx (PANES)
      ui/                  shared views: boot screen, error boundary, notifications host, PaneLayout, keyboard hints
      app/                 App, providers + theme, keymap.json, commands.ts, global shortcuts
      services/            desktop bridge (Electron preload) and clipboard
      test/                Vitest setup and render helpers
    __mocks__/zustand.ts   resets every store between tests
  launcher/
    src/prompt_weaver_launcher/cli.py
```

### Single sources of truth

- **Shared data types.** `backend/app/schemas.py` is the truth. From `frontend/`, run `npm run gen:api` to export the OpenAPI document to `backend/openapi.json` and generate `frontend/src/api/schema.gen.ts` from it. The frontend imports named aliases from `src/api/types.ts`; never hand-write a TypeScript mirror. Two tests fail when either generated file is stale: `backend/tests/test_openapi_snapshot.py` and `frontend/src/api/apiTypes.test.ts`.
- **Host and ports.** `config/defaults.json` is read by the launcher, `backend/run_backend.py` and `config/appConfig.cjs` (Vite and Electron). The frontend builds every backend URL in `src/api/config.ts`.
- **Frontend state.** Each domain has exactly one zustand store that owns its state and actions (see below).
- **Untrusted values.** Persisted and imported data is validated through `src/domain/guards.ts`; lists of backend enum values (seed behaviors, torch dtypes) are exhaustive typed records, so the type-check fails when the schema changes.

### Frontend stores

The frontend is organized around zustand stores, one per domain. Each store is the single holder of its domain's state and owns its actions: API calls, WebSocket handling, persistence and cross-store coordination (`useOtherStore.getState().action()`) happen in store actions, never in components. Pure algorithms live in `src/domain` and are unit-tested; derived data is computed by selectors and memoized hooks, never stored twice. Components are thin views: they subscribe with fine-grained selectors, call actions, and keep only ephemeral UI state (an edit draft, an open dialog, the rect during a drag). Store logic is tested without rendering.

| Store | Owns | Persisted as |
| --- | --- | --- |
| `categoriesStore` | categories and sub-prompts; reachability ("indirectly disabled") hooks | `categorie-store` |
| `forbiddenRulesStore` | forbidden rules, the association source of the Used sub-prompts pane, highlights | `forbidden-associations-store` |
| `libraryStore` | models, LoRAs, model/LoRA selection, file dialogs | `library-store` |
| `generationSettingsStore` | size, steps, CFG, negative prompt, seed inputs and behaviors | `settings-store` |
| `generationStore` | single and continuous generations, cancel | - |
| `outputsStore` | output ids, current output and its metadata, delete/restore, copy | `current-image-store` |
| `undoStore` | undo stack (generation steps, deletions) | - |
| `tasksStore` | latest task event per task (`/ws/tasks`), generation progress | - |
| `workspaceStore` | window layouts and stacking, closed panes, visibility mode | `workspace-store` |
| `notificationsStore` | user-facing errors, warnings and confirmations | - |
| `sessionStore` | boot: bootstrap, hydration of every persisted store, legacy seeding | - |

Persisted stores are declared with `persistedStoreOptions` (`src/persistence/persist.ts`) and their names come from `src/persistence/storeNames.ts`; a shape change bumps the store version and adds a `migrate` with a test.

### Persistence

- The backend persists the frontend stores at `<data dir>/stores/<name>/state.json`, through `GET/PUT/DELETE /api/stores/{name}`. Each file holds the zustand envelope `{"state": ..., "version": n}`. The formats written by the former Electron storage still load: JSON `null`, a legacy string map, and legacy flat `<name>.json` files. A file that exists but cannot be read is reported as an error rather than treated as empty, so it is never overwritten.
- `src/persistence/persist.ts` is the only persistence mechanism. It hydrates stores explicitly at boot, ignores writes until a store has been read, coalesces writes, and runs legacy merge migrations.
- On first start, stores without persisted data are seeded from the legacy `app_state.json` and `library.json`, which `GET /api/bootstrap` returns (LoRA references missing from the library are stripped). The app no longer saves its state to these two files.
- The frontend reads outputs through the backend API: `/api/outputs`, `/api/outputs/{id}`, `/api/outputs/{id}/image`, `/api/outputs/{id}/trash` and `/api/trash/{id}/restore`.

### Extension points

- **New panes** (for example a model library, image library or characters pane): add or extend a store in `src/stores` (logic in `src/domain`), then the view in `src/features/<area>` (using `src/ui/PaneLayout.tsx`), then one entry in `frontend/src/workspace/paneRegistry.tsx`. The app bar gets its show/hide toggle automatically.
- **New API areas:** add `backend/app/routers/<area>.py` exposing an `APIRouter`, append it to `ROUTERS`, put its logic in a service wired in `services/container.py`, add its models to `schemas.py`, then run `npm run gen:api` and add the client calls to `src/api/client.ts`.
- **Background tasks:** progress events form one discriminated union, `TaskEvent` = `GenerationTaskEvent | DownloadTaskEvent`, keyed by `task_id` and published through `TaskHub.publish` from any thread. The frontend reads them from `tasksStore`.
- **New shortcuts:** add the command to `APP_COMMANDS` and its handler in `src/app/commands.ts`, and the binding to `keymap.json` (a test checks both agree).

## Stack

- Backend: FastAPI, Pydantic v2, uvicorn, Pillow, `diffusion-lora-runtime` (editable path dependency), managed with `uv`, tested with pytest + httpx (`dev` dependency group).
- Frontend: Electron, React 18, TypeScript, Vite 8, zustand, Fluent UI React v9 (`@fluentui/react-components`, `@fluentui/react-icons`), openapi-fetch + openapi-typescript, tested with Vitest, jsdom and Testing Library.

## Running on Windows

### One-time setup

```powershell
cd frontend
npm install
cd ..
```

`uv` resolves the backend dependencies automatically from `backend/`. The diffusion runtime is an editable path dependency on the local checkout, declared in `backend/pyproject.toml`:

```toml
[tool.uv.sources]
diffusion-lora-runtime = { path = "D:/Anything/libs/diffusion-lora-runtime", editable = true }
```

Changes in that checkout take effect at the next backend start.

### Unified launcher

Use the Python launcher in `launcher/`. It is declared with the reusable `devlauncher` API, whose local checkout is expected at:

```powershell
D:\Anything\libs\devlauncher_reusable_pattern
```

From the repository root:

```powershell
uv run python -m launcher
```

Useful variants:

```powershell
uv run python -m launcher --web
uv run python -m launcher --no-electron
uv run python -m launcher --web --no-electron
uv run python -m launcher --host 0.0.0.0 --backend-port 9000 --frontend-port 5174
uv run python -m launcher --only backend
uv run python -m launcher --skip frontend
```

Behavior:

- default host and ports come from `config/defaults.json`
- starts the backend with `uv run python run_backend.py --host {host} --port {backend_port}` from `backend/`
- starts the Vite dev server from `frontend/`
- starts Electron by default
- passes the backend URL to the frontend and Electron through `PROMPT_WEAVER_BACKEND_URL`, so `--host` and `--backend-port` reach the UI
- `--web` opens the frontend in the default browser once it is ready
- `--no-electron` disables the Electron shell
- `--only` and `--skip` narrow which declared services start
- `Ctrl+C` stops every child process cleanly

### Manual commands

Backend only (host and port default to `config/defaults.json`):

```powershell
cd backend
uv run python run_backend.py
```

Frontend dev server only:

```powershell
cd frontend
npm run dev
```

Electron against the dev server:

```powershell
cd frontend
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:5173"
npm run electron:start
```

## Tests and checks

Tests never touch the real data directory or the model folders. The backend tests point `PROMPT_WEAVER_DATA_DIR` at a temp dir and use a fake generator, so no model or GPU is needed.

```powershell
cd backend
uv run pytest              # API tests (TestClient) + service unit tests

cd frontend
npm test                   # Vitest: domain, stores, persistence, API client, components, Electron helpers
npm run typecheck          # tsc -b
npm run build              # type-check + production bundle
npm run gen:api            # regenerate backend/openapi.json + src/api/schema.gen.ts after changing schemas.py
```

If `VIRTUAL_ENV` points at another virtual environment, unset it before running `uv` commands in `backend/`.

## Notes and constraints

- Model loading expects a Diffusers-compatible model directory or a checkpoint supported by `diffusion-lora-runtime`.
- A LoRA entry can point to either a file or a directory. Every LoRA is applied with weight 1.0 for now.
- The shared `diffusion-lora-runtime` package handles runtime model loading, LoRA loading, inline prompt LoRA resolution, textual-inversion resolution and KSample mapping. The backend imports it on the first generation only, because importing it loads torch.
- Width, height, steps and CFG stay user-editable in the UI.
