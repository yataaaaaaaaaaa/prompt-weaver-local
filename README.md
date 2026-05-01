# Prompt Weaver Local

Local Windows-first desktop tool for prompt-combinator diffusion generation.

## What it does

- Runs fully locally.
- Uses the shared `diffusion-lora-runtime` package to keep the current diffusion model and loaded LoRAs in memory.
- Uses Electron + React/TypeScript for the desktop UI.
- Lets you pick:
  - one diffusion model
  - N LoRAs
  - width / height / steps / CFG
  - seed mode and seed advance behavior
- Builds the final positive prompt by selecting one prompt per active category.
- Supports exact forbidden prompt pairs and text-based forbidden rules.
- Supports categories that are disabled by default and only become active when selected prompts contain a trigger text.
- Saves every generation as an image plus adjacent JSON metadata in:
  - `D:\Anything\storage\prompt-weaver-local-storage\output`
- Stores app state and library metadata in:
  - `D:\Anything\storage\prompt-weaver-local-storage`

## Current behavior

### Models and LoRAs

- Models are selected from a dropdown.
- LoRAs are selected from a multi-select dropdown.
- Electron file dialogs are used to add:
  - model directories
  - LoRA files
  - LoRA directories
- The app remembers the last model folder and last LoRA folder used.
- The backend keeps the current model in memory and only reloads LoRAs when needed.
- Prompts can induce extra LoRAs through `extra_lora_ids`.

### Prompt categories

- Each category appears in its own movable box.
- Categories support:
  - rename
  - add/remove prompts
  - prompt editing by click selection
  - lock one prompt so it stays selected until unlocked
  - skip a category from generation
  - optional activation text
- If `activation_text` is non-empty, the category is disabled by default and only participates when another selected prompt contains that text.
- Forbidden rules take precedence over activation. Triggered categories are optional and are skipped if they conflict.

### Forbidden rules

Supported forms:

- specific prompt ↔ specific prompt
- specific prompt ↔ any prompt containing text in one category
- specific prompt ↔ any prompt containing text in any category

Matching stability:

- exact prompt rules normalize prompts by ignoring:
  - casing
  - whitespace
  - comma-tag order

UI behavior:

- Click one prompt, then click a prompt in another category to toggle an exact forbidden relation.
- Text-based forbidden rules are edited from the selected prompt editor.
- Matching forbidden prompts are highlighted in red in other categories.

### Seed workflow

Seed is controlled from the UI.

- `Seed mode = Randomize`
  - sends no seed to the backend
- `Seed mode = Manual`
  - sends the numeric seed from the UI

After each generation, the seed behavior can be:

- `Keep`
- `Auto increment`
- `Randomize`

### Output browser

The UI has three main movable and resizable panes:

- image pane
- generation interface pane
- image generation info pane

Output behavior:

- every new generation is saved into `output/`
- filenames are fixed-width 10-digit numbers:
  - `0000000001.png`
  - `0000000001.json`
- after a generation, the UI always jumps to the latest output
- left/right arrow keys navigate the output folder history
- the current image metadata pane includes:
  - size
  - CFG
  - seed
  - model
  - LoRAs
  - named category + selected prompt
- there is a button to copy the full prompt of the selected output

### Delete and undo

- Delete moves the image and its JSON metadata into the app-managed trash folder:
  - `D:\Anything\storage\prompt-weaver-local-storage\trash`
- Undo currently supports:
  - the last generation UI step
  - the last deletion, including restoration from the app trash folder

The delete/undo implementation is app-managed so restoration is reliable.

### Progress reporting

- The backend sends progress updates to the UI through a WebSocket.
- The UI progress bar updates during model load / LoRA prep / diffusion sampling / saving.
- Sampling progress is reported per diffusion step when the underlying pipeline callback is available.

## Project layout

```text
prompt-weaver-local/
  backend/
    app/
      main.py
      storage.py
      schemas.py
      settings.py
    pyproject.toml
    run_backend.py
  frontend/
    electron/
      main.cjs
      preload.cjs
    src/
      App.tsx
      api.ts
      types.ts
      utils.ts
      components/
  launcher/
    pyproject.toml
    src/
      prompt_weaver_launcher/
        cli.py
```

## Backend stack

- FastAPI
- `diffusion-lora-runtime` from `D:\Anything\libs\diffusion-lora-runtime`
- Pillow
- Pydantic
- uvicorn
- managed with `uv`

## Frontend stack

- Electron
- React
- TypeScript
- Vite

## Running on Windows

### One-time setup

```powershell
cd frontend
npm install
cd ..
```

The backend dependencies are resolved automatically by `uv` from `backend/`. The diffusion runtime is resolved from the shared local Git repository configured in `backend/pyproject.toml`:

```toml
[tool.uv.sources]
diffusion-lora-runtime = { git = "file:///D:/Anything/libs/diffusion-lora-runtime", branch = "main" }
```

Change `branch = "main"` to another branch, tag, or revision when this app should consume a different runtime line.

### Unified launcher

The legacy `.bat` launchers were removed. Use the Python launcher in `launcher/`.

The launcher is declared with the reusable `devlauncher` API. The local checkout is expected at:

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

- starts the backend with `uv run python run_backend.py --host {host} --port {backend_port}` from `backend/`
- starts the Vite dev server from `frontend/`
- starts Electron by default
- `--web` opens the frontend in the default browser after the frontend is ready
- `--no-electron` disables the Electron shell
- `--only` and `--skip` can narrow which declared services are launched
- `Ctrl+C` stops every child process cleanly

### Manual commands

Backend only:

```powershell
cd backend
uv run python run_backend.py
```

Frontend dev server only:

```powershell
cd frontend
npm run dev -- --host 127.0.0.1 --port 5173
```

Electron against the dev server:

```powershell
cd frontend
$env:VITE_DEV_SERVER_URL = "http://127.0.0.1:5173"
npm run electron:start
```

## Notes and constraints

- Model loading currently expects a Diffusers-compatible model directory or checkpoint supported by `diffusion-lora-runtime`.
- LoRA entries can point to either a file or a directory.
- Runtime model loading, LoRA loading, inline prompt LoRA resolution, textual inversion resolution, and KSample mapping live in the shared `diffusion-lora-runtime` package.
- Width / height / steps / CFG stay user-editable in the UI.

## Validation performed here

- frontend TypeScript build passes
- backend unit tests pass
- launcher Python source compiles

Full local Electron execution and real image inference were not run in this environment because local Windows GPU/model assets are not available here.
