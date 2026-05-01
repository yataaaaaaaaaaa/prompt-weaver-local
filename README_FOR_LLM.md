# Prompt Weaver Local — README FOR LLM

This file is the compressed handoff state for continuing the project in a new chat.
It should be updated whenever code changes are made.
From now on, every code-change answer must update this README.

## User expectations for future LLM turns

- Keep answers compact.
- Always return an updated ZIP artifact when code changes are requested.
- Default to a **full repack** ZIP unless the user explicitly asks otherwise.
- Run and report:
  - frontend TypeScript typecheck: `npm exec tsc -b`
  - backend tests: `uv run pytest`
- Do not dump full files unless explicitly asked.
- Keep this README current so a new chat can resume work immediately.

## Latest handoff notes (2026-03-30)

- LoRA management UI was revised: the control pane now uses explicit per-LoRA checkboxes and supports deleting a LoRA from the local library, while also stripping stale references from category sub-prompts.
- The former "Current generation settings" pane was merged into the main generation pane, the standalone current-image metadata pane is no longer rendered, and the used-sub-prompts pane now shows the sub-prompt as a single copyable button instead of duplicate raw text plus button treatment.
- Added prompt seed mode `per_category_cycle`: each active category advances with its own counter, starts from a random seed, restarts from a new random seed after one full cycle, still increments when the seeded prompt lands on `skip` or a forbidden association, and still respects locked prompts unless they are forbidden.
- Fixed prompt-selection seeding so the actual seed used for frontend prompt selection matches the seed recorded/sent for generation, including randomize mode.

- Added a per-floating-panel **reduce/send-to-back** button; it lowers the panel/category z-index to the current minimum bucket.
- `currentImageStore` was optimized for large output folders:
  - removed the redundant rehydrate-time full rescan
  - added output-folder watching from Electron preload
  - added incremental add/remove tracking in the renderer store
  - generation completion now registers/selects the new output directly instead of rescanning the whole folder
  - delete now updates the in-memory index directly instead of rescanning before/after trashing
- Generation UX latency after backend completion was reduced by clearing the `generating` flag immediately after `/generate` returns, before post-generation image reload finishes.
- Category deletion now asks for confirmation with a validation dialog.
- `Ctrl+O` handling was hardened in two small ways:
  - duplicate shortcut dispatches are suppressed for a short window
  - category priority input text now resyncs after reorganize renumbering
- Added a renderer-accessible `watchDirectory()` desktop API bridge in preload/types/electronFs.

## Project baseline

- App: **Prompt Weaver Local**
- Platform: Windows-local desktop app
- Frontend: Electron + React + TypeScript
- Backend: Python FastAPI
- Runtime package: shared `diffusion-lora-runtime` from `D:\Anything\libs\diffusion-lora-runtime`
- Python environment: **uv**
- Torch must stay on **CUDA 12.8**

## Architectural intent

### Backend should ideally only do

- call `diffusion_lora_runtime.DiffusionGenerator.generate()`
- pass model path, LoRAs, KSample config, prompt LoRA dir, and embedding dir
- save returned image/metadata
- expose progress/cancel/runtime API only

Model loading, LoRA loading, inline LoRA prompt resolution, textual inversion resolution, KSample mapping, and memory reuse live in the shared `diffusion-lora-runtime` package.

### Frontend should ideally do

- prompt generation
- state management
- ID generation
- UI persistence
- most app logic

## Storage / outputs

- Outputs are saved under `D:\Anything\storage\prompt-weaver-local-storage\output`
- Filenames are 10-digit auto-increment numbers:
  - `0000000001.png`
  - matching `0000000001.json`
- Delete moves files to app-managed trash
- Undo exists
- Last selected image restores on reopen
- Output browsing supports previous/next + first/last

## Global shortcuts / UI behavior

- `Ctrl+H`: cycle visibility modes
- `Ctrl+O`: reorganize category boxes, then in a second pass renumber priorities to `index + 1`, fit-size with height cap
- `Ctrl+G`: start generation only if nothing is already running or pending
- `Ctrl+T`: toggle continuous generation
- Category boxes are movable/resizable and persistent
- Category overlay can be hidden/shown
- Separate panes now exist for:
  - image-only
  - image browser / metadata / navigation
  - generation controls
  - used sub-prompts
  - category boxes

## Category / prompt model

- Each category contains sub-prompts.
- Empty sub-prompts are valid and selectable.
- Locked empty sub-prompts are valid.
- Left click:
  - sub-prompt => editable textarea + selected-sub-prompt
  - category name => editable textarea
  - condition area => editable textarea
- Enter saves and deselects.
- Blur saves.
- Textareas should behave like normal textareas.
- Full select only when textarea first appears.
- Cursor must not jump to start while typing.
- `Ctrl+Z` should work natively in textareas.
- Category box internal scroll should auto-adjust so associated sub-prompt is visible on start and on image change.

### Category capabilities

- skip
- add sub-prompt
- bulk edit all sub-prompts with `\n|\n`
- editable floating priority

### Sub-prompt capabilities

- skip
- lock
- delete

## Identity / normalization rules

Important: IDs are **runtime only**.
They are not durable identities and are only used as a more robust runtime comparison aid than raw text.

- Sub-prompt runtime IDs must **not** include category text.
- Persisted precomputed IDs from older states should be ignored.
- Prefer text equivalence helpers over assuming stored IDs are meaningful.
- Category IDs remain name-derived using normalized snake-cased trimmed category name.
- Stored outputs/state should not rely on persisted prompt/category IDs.

A helper like `areNameEquivalent()` should use the custom normalization method.

## Forbidden associations

- Forbidden associations are stored as **text**, for backward compatibility.
- When used, they are resolved lazily to runtime comparison identities / normalized equivalence.
- Forbidden filtering has priority over activation.
- Right click with selected-sub-prompt toggles forbidden association.
- Locked forbidden associations are purple.
- Forbidden associations are red.

## Prompt generation

Prompt generation is frontend-owned.
Backend `/api/generate` receives already-computed prompt/selections.

Rules:

- Concatenate with `",\n"`
- Collapse `",\s*,"` to `","`
- Category activation uses comma-separated OR terms
- Loop activation until no new category activates
- Forbidden filtering has priority over activation

## Seeds

Two separate seeds:

- prompt seed
- image seed

Each seed has independent mode:

- fixed
- increment
- randomize

Each has a manual dice button.
Continuous generation uses current frontend state and current seeds on each iteration.

## LoRA / embedding support

UI buttons remain:

- Select checkpoint
- Add LoRA

Prompt support:

- inline A1111 LoRA syntax: `<lora:name:weight>`
- inline embedding syntax

Lookup rules:

- recursive strict search by filename stem only
- LoRA path: `D:\Anything\ComfyUI\ComfyUI\models\loras`
- Embeddings path: `D:\Anything\ComfyUI\ComfyUI\models\embeddings`
- If a LoRA sidecar `.txt` exists next to the LoRA file, its content replaces the inline LoRA token in the prompt
- Some ComfyUI-working files may still be incompatible with diffusers LoRA loading

## Backend/runtime details

Already-established backend/runtime direction:

- uvicorn forced to `--http h11 --ws websockets`
- long-prompt / embedding support lives in `diffusion-lora-runtime`
- generate cancel endpoint exists
- stop continuous tries to cancel in-flight backend generation
- preflight logs of prompt / lora / KSample config print to console
- backend prompt engine has been removed from the active architecture; frontend is the source of truth for prompt logic
- backend generation path should be serialized explicitly to avoid overlapping mutable runtime operations

## Current state machine intent

### Stored state

Sub-prompt stored state:

- `normal`
- `skip`
- `lock`

Category stored state:

- `normal`
- `skip`

## Editing behavior

No structural graph/UI-state recomputation with side effects while a textarea is open.

When editing:

- sub-prompt text
- category name
- category condition
- bulk prompt text

The new text should stay in an isolated edit buffer until validation/commit.

## Used-sub-prompts pane expectations

- Lets user create/disable forbidden associations
- Should clearly distinguish category vs sub-prompt
- Text should be selectable

## Launcher expectations

- Use the Python launcher in `launcher/` instead of legacy Windows `.bat` launchers.
- Frontend launchers were reported broken and need to stay verified.
- Current scripts of interest from the repository root:
  - `uv run python -m launcher`
  - `uv run python -m launcher --web`
  - `uv run python -m launcher --no-electron`
  - `uv run python -m launcher --web --no-electron`
- Electron starts by default; use `--no-electron` to suppress it.

## Validation expectation after code changes

Always report at least:

- TypeScript typecheck result
- backend test result

If something could not be fully verified in this environment, say so explicitly.

## Startup / shutdown expectations

- Frontend-only startup must not open the UI before the backend is actually reachable.
- The Electron frontend may auto-start the backend, but it should first detect whether a backend is already running on `127.0.0.1:8000` to avoid double-start/port-conflict behavior.
- The unified launcher is declared with the reusable `devlauncher` API from `D:\Anything\libs\devlauncher_reusable_pattern`.
- The unified launcher starts the backend through `run_backend.py`, not an inline `uvicorn ...` command, so shutdown settings stay centralized.
- `Ctrl+C` on the backend should cancel generation quickly and shut down without a long graceful wait.
- Progress websocket disconnects during startup/shutdown should be handled quietly; they must not spam the console with avoidable ASGI stack traces.

### shortcut behavior

- `Ctrl+G`: start generation if no generation is currently running/pending.
- `Ctrl+T`: toggle continuous generation.
- `Ctrl+D`: compute / refresh `indirectly-disabled` snapshot on demand.
- `Ctrl+H`: cycle visibility modes.
- `Ctrl+O`: reorganize category boxes, then reindex priorities with a second pass.

### Electron menu requirement

- The desktop window must expose a `Shortcuts` menu placed immediately before `Help`.
- The menu must list the available shortcuts and allow triggering those operations from the menu itself.
