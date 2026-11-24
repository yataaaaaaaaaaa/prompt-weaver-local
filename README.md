# Prompt Weaver Local

A local, Windows-first desktop tool for prompt-combinator diffusion generation.

## What it does

- Runs fully locally: a FastAPI backend drives the shared `diffusion-lora-runtime` package, and an Electron + React desktop UI built with Fluent UI 2 talks to it.
- Keeps the current diffusion model and its loaded LoRAs in memory between generations.
- Lets you pick:
  - one diffusion model
  - N LoRAs, each with its own weight
  - width / height / steps / CFG
  - a prompt seed and an image seed, each with its own behavior after each generation
- Builds the final positive prompt by choosing one sub-prompt per active category.
- Supports forbidden associations between sub-prompts, categories and tags.
- Supports categories that are disabled by default and only become active when a selected sub-prompt contains their activation text.
- Has an online model library: search Civitai for checkpoints, LoRAs and embeddings, and pick one to use it. If the file is not on disk yet it is downloaded into the ComfyUI model folders, verified, added to the local library and selected for generation.
- Has an online image library: search Civitai images by keyword, see each image's tags, LoRAs (with their weights), checkpoint and generation parameters, and in one click use the same LoRAs with the same weights (missing ones are downloaded first), switch to the same checkpoint, or add the tags to a prompt category.
- Has characters, for character consistency: a character bundles identity tags (appearance), outfit tags (kept separate), negative tags, optional LoRAs with weights, an optional locked seed and up to 4 reference images. Activate one in one click and every generation keeps that person: its tags go through the prompt engine as pinned categories, and its reference images steer the image through an IP-Adapter when one is available for the model. Create one by hand, or from an output or an online image, prefilled.
- Saves every generation as an image plus an adjacent JSON metadata file in `<data dir>/output`.
- Keeps everything else in the data directory too: frontend state (`<data dir>/stores`), the app-managed trash (`<data dir>/trash`), backend settings such as the optional Civitai API token (`<data dir>/backend_settings.json`), the file hash cache (`<data dir>/cache/file_hashes.json`), the favorite online images (`<data dir>/image_favorites.json`), the characters and their images (`<data dir>/characters`) and the legacy `app_state.json` / `library.json`.

The data directory is `D:\Anything\storage\prompt-weaver-local-storage` on Windows, or `<repo>/.prompt_weaver_local_data` on other systems. Set the `PROMPT_WEAVER_DATA_DIR` environment variable to use a different one. The backend owns this layout in `backend/app/settings.py`.

Model files live in the ComfyUI models folder, `D:\Anything\ComfyUI\ComfyUI\models` (`DEFAULT_MODELS_ROOT` in `backend/app/settings.py`), in its `checkpoints`, `loras` and `embeddings` sub-folders (`MODEL_KIND_SUBDIRS`). Model library downloads go there, and inline LoRA tags and embeddings in prompts are resolved from there. The IP-Adapter files of character reference images use the ComfyUI folders too: adapters in `ipadapter` (`IP_ADAPTER_SUBDIR`), image encoders in `clip_vision` (`IMAGE_ENCODER_SUBDIR`).

## Current behavior

### Workspace

- The workspace holds movable, resizable floating windows: the panes (Image, Output browser, Generation, Used sub-prompts, Model library, Image library, Characters) and one card per prompt category. Every window shares one stacking order; clicking a window brings it to the front.
- Drag a window by its header and resize it with the bottom-right grip. Both handles also work from the keyboard: focus them and use the arrow keys (8 px per press, 40 px with `Shift`).
- Each window header has a "Send to back" button; panes also have a Close button.
- The app bar at the top has Add category, Reorganize categories, one toggle per pane to show or hide it, the visibility mode, and Undo. Tooltips show the keyboard shortcuts.
- Window positions, sizes, stacking order and closed panes are saved. Layouts saved by older versions (`panel-layouts-store` + `workspace-z-index-store`) are migrated into `workspace-store` on first start and left untouched.
- `Ctrl+H` cycles visibility between everything, categories only, and panes only.
- `Ctrl+O` sorts the categories by priority, then name, renumbers their priorities and arranges their cards in a grid.
- The UI follows Microsoft Fluent 2 (Fluent UI React v9) and switches between light and dark to match the OS setting, live.
- Web links (Civitai model and image pages) open in the system browser, never inside the app window (`frontend/electron/externalLinks.cjs`).

### Models and LoRAs

- Choose the model from a dropdown in the Generation pane.
- The LoRA list has one checkbox per LoRA for the default selection, plus Clear, Add files and Add folder. LoRAs that a sub-prompt pulls in are marked "Prompt-linked" and can be unlinked from every sub-prompt in one click. A summary shows the default-selected, prompt-linked and possibly active counts.
- Every selected LoRA has its own weight, edited with the "Weight of <name>" spin button next to its checkbox (arrow keys step it; typed values are clamped). The range is -10 to 10 in steps of 0.05, default 1 (`LoraWeightDefaults` in `backend/app/schemas.py`). A LoRA enters the selection at weight 1 (checkbox, added files, model library installs); "Use these LoRAs" of the image library sets the image's weights. LoRAs that only a sub-prompt pulls in are applied at weight 1; a LoRA both selected and prompt-linked keeps its selected weight.
- Add models and LoRAs through Electron file and folder dialogs:
  - model files (`.safetensors`, `.ckpt`) or a Diffusers model directory
  - LoRA files (`.safetensors`, `.bin`, `.pt`, several at once) or LoRA directories
- The dialogs open in the last model folder or last LoRA folder you used. They need the desktop app; in a plain browser the app says so instead.
- Adding a model or LoRA whose path is already in the library reuses (and selects) the existing entry.
- The backend keeps the current model and its LoRAs loaded between generations. Only a different model (path, dtype, sampler or scheduler) reloads the model. LoRA changes are incremental (`diffusion-lora-runtime` 0.4.0): added LoRAs are loaded, removed ones are deleted from the pipeline, and a weight-only change just re-applies the adapter weights, so changing a weight, the LoRA set or the active character no longer reloads the model. Inline `<lora:...>` LoRAs follow the same rules; textual inversions stay loaded.
- A sub-prompt can pull in extra LoRAs (`extra_lora_ids`). Removing a LoRA from the library also unlinks it from every sub-prompt.
- The runtime resolves inline `<lora:name:weight>` tags against the ComfyUI `loras` folder and textual-inversion embeddings (`embedding:name`) against the `embeddings` folder (see the model folders above).
- Library entries installed from the model library keep their provenance (provider, model, version and file ids, SHA-256, preview image, base model, trigger words, page URL). Entries added from disk have none and show as "Local file".

### Model library

The Model library pane (app bar toggle "Model library") has two tabs.

**Online** searches Civitai:

- A search box (it searches as you type), plus filters:
  - type: Checkpoint (Civitai `Checkpoint`), LoRA (`LORA`, `LoCon`, `DoRA`), Embedding (`TextualInversion`)
  - base model: SD 1.5 / LCM / Hyper, SD 1.4, SDXL 1.0 / Lightning / Hyper / Turbo, Pony, Illustrious, NoobAI. Pony V7, SD 2.1, SD 3.5 and Flux.1 D/S are listed too, marked "Not supported locally", because the runtime cannot load them.
  - sort: Most downloaded, Highest rated, Newest
  - NSFW switch: preview images with a Civitai `nsfwLevel` above 2 are hidden unless it is on
- Results load page by page ("Load more"). Each card shows the preview of the picked version, name, creator, type, base model, a version picker, the file size, the trigger words (with a copy button) and a status: On disk, In library / Selected, Downloading, Failed or Not supported. The status labels are shared with the image library and the IP-Adapter files (`frontend/src/features/models/VersionStatusBadge.tsx`).
- The card action depends on the status:
  - "Download and use" for a file that is not on disk;
  - "Use" for a file already on disk or in the library;
  - a progress bar with Cancel while it downloads;
  - Retry / Dismiss after a failure;
  - a disabled button with the reason when the version cannot be installed.
- Selecting a version always goes through the backend, which first looks for the file on disk: by name and size, or by SHA-256 among files of the same size anywhere under the kind's folder, so renamed or moved copies are found. A file already on disk is never downloaded again.
  - Checkpoints become the selected model, and LoRAs are added to the selected LoRAs.
  - Embeddings have no library entry: the app tells you the prompt token to use (`embedding:<file name>`), and "Copy prompt token" copies it.
- Downloads keep running when the pane is closed. After a reload, the app picks up the downloads still running in the backend; downloads that no card shows are listed in a Downloads section.
- Only SafeTensors files (Civitai file type Model or Pruned Model) can be downloaded. Pickle files (`.pt`, `.ckpt`) are shown but refused, and so is a version whose base model the runtime cannot load.
- "Civitai token" stores an optional Civitai API token, which some downloads require. The backend keeps it in `<data dir>/backend_settings.json`. It is never sent back to the UI (only whether one is set), never logged and never included in error messages. When set, it is sent as `Authorization: Bearer` to Civitai only: it is dropped when a download is redirected to Civitai's storage host.

**Local library** lists the checkpoints and LoRAs of the library with their provenance (preview, base model, version, trigger words) or "Local file", and their path. Checkpoints have "Use"; LoRAs have "Use by default" and Remove. The tab also shows the three model folders.

Downloads:

- A download streams into `<target>.part` next to the target file. The file is renamed into place only after its SHA-256 and size match what Civitai published; a mismatch deletes the `.part` file and fails the download. A `.part` file left by a crash is deleted when that file is downloaded again.
- At most 2 downloads run at once; the others wait as "queued". Network errors, HTTP 5xx and 429 are retried (3 attempts, 2 s apart), resuming with an HTTP `Range` request when the server supports it. Other 4xx answers fail at once; 401/403 explain that a Civitai token is needed or was rejected.
- A file already present at the target is never overwritten: it is reported as already downloaded when it matches, and the download fails otherwise. When a different file holds the name, the download uses `<name>-<version id>` (then `-<version id>-<file id>`, then a number).
- Starting the same download twice (double click, a second window) joins the running one. Closing the app cancels running downloads and waits at most 10 s.
- Progress, completion, errors and cancellation are `DownloadTaskEvent`s on `/ws/tasks` and `GET /api/tasks`, like generation progress. Their messages never contain URLs (signed storage URLs carry credentials) or headers.
- The SHA-256 of every model file the backend hashes or downloads is cached in `<data dir>/cache/file_hashes.json`, valid while the file's size and modification time are unchanged, so later checks need no hashing. The cache is derived data and safe to delete.

### Image library

The Image library pane (app bar toggle "Image library") has two tabs, Search and Favorites. Picking a thumbnail opens its detail view in the pane; Back or `Escape` returns to the grid, with the focus on the image you opened.

**Search** lists Civitai images in a grid of thumbnails that loads more as you scroll (a "Load more" button does the same):

- A search box (it searches as you type), plus:
  - sort: Most reactions, Most comments, Most collected, Newest
  - period: Day, Week, Month, Year, All time. It only applies without a keyword (it is disabled, with a hint, while a keyword is typed).
  - "Show NSFW" (off by default: only images Civitai rates safe, `nsfwLevel` 1-2, are shown)
  - "Only locally usable models" (on by default: only images made with a base model the local runtime can load)
- Keywords search the models' galleries. The Civitai images API has no free-text filter (it ignores `query`, and `tags` only takes numeric tag ids), so a keyword is looked up in the model catalog (the model library search: LoRAs and checkpoints, most downloaded, up to 4 models, with the usable base models when that switch is on), and the page interleaves the image galleries of those models, read through each model's newest version made for an allowed base model (Civitai answers version galleries in well under a second, whole-model galleries in up to 20 s). When those galleries run out, the next models of the search are used. An empty keyword browses the Civitai image feed with the sort and period.

**Detail view** of an image:

- the large preview, author, base model ("Not supported locally" when the runtime cannot load it), Favorite, "Copy prompt", "Create character" (see Characters) and a link to the image page on civitai.com;
- **Tags**: the prompt split into tags, inline `<lora:...>` tags removed. "Add to category" adds them, all or only the tags you select, as one new sub-prompt of the category you pick, or of a new category. A sub-prompt that already exists in that category is refused.
- **LoRAs**: each LoRA with its name (linked to its Civitai page once identified), its weight ("unpublished, default" when the image publishes none) and its status: In library, On disk, Available to download, Downloading (with the progress bar and Cancel of the model library), Failed, Not supported, Not identified or Resolving; the reason is in a tooltip.
- **Use these LoRAs** makes the selection exactly the image's LoRAs, with the image's weights. LoRAs already in the library are used as they are; missing ones are installed through the model library first (same downloads, progress and checks; a download already running is joined); LoRAs that cannot be identified, downloaded or loaded are skipped with a warning listing why. When none can be used, the selection is left unchanged.
- **Checkpoint**: the checkpoint the image was made with, its status, and "Use this checkpoint", which selects it, after installing it through the model library when needed.
- **Generation parameters**: prompt, negative prompt, sampler, steps, CFG, seed, size and clip skip, as published (an em dash when missing).

How an image's models are found:

- The backend reads the image metadata Civitai publishes and merges its sources into one entry per model (`backend/app/services/model_providers/civitai_image_meta.py`, rules in its docstring): `civitaiResources` (version ids and weights of images made on Civitai), `resources` (name, weight, hash), `hashes`, `Model` / `Model hash`, and the inline `<lora:name:weight>` tags of the prompt (parsed by `diffusion_lora_runtime.prompt_lora`). Types other than checkpoints, LoRAs and embeddings (VAE, upscalers...) are ignored.
- Each model is then identified by its version id, else by its file hash: Civitai's short AutoV2 (10 hex) and AutoV3 (12 hex) hashes are accepted, as well as a full SHA-256. A model published by name only cannot be identified.
- A library entry of the same kind is used when its provenance (version) or SHA-256 matches, or else when its file name without extension equals the published name (case-insensitive).

**Favorites** keeps images you mark with Favorite, newest first. The backend stores them in `<data dir>/image_favorites.json` (`{"version": 1, "items": [...]}`); unreadable entries are skipped.

### Characters

A character makes the same person appear across generations. It holds a name and a thumbnail, identity tags (appearance: face, hair, eyes, body), outfit tags (kept separate from the identity), negative tags, optional character LoRAs with their weights (the same `LoraWeight` as the LoRA selection), an optional seed that can be locked, and up to 4 reference images with a reference focus (Face or Whole subject) and a strength (0 to 1, default 0.6; `ReferenceDefaults` in `backend/app/schemas.py`).

Creating a character (each opens the editor in the Characters pane, which comes to the front):

- **New character**, in the Characters pane or in the Character section of the Generation pane.
- **Create character** in the Output browser, prefilled from the output shown: its selections become the identity tags (a 'Character outfit' selection becomes the outfit tags), its LoRAs with their weights, its image seed (not locked); the output image becomes the first reference image.
- **Create character** in an image's details (Image library), prefilled from the image: its tags, its LoRAs with their weights (found like "Use these LoRAs": missing ones are installed first, the others are skipped with a warning), its seed; the image becomes the first reference image.

The **Characters pane** (app bar toggle "Characters") shows:

- the **editor** while it is open: name, identity / outfit / negative tags (comma-separated), LoRAs (pick from the library, a weight field per LoRA), seed and "Lock seed", reference focus, reference strength, reference images (a new character shows the images it will import; a saved one adds "Add current output" and "Add image file", and has "Use as thumbnail" and Remove per image), Save and Cancel. Save is disabled while a field is invalid;
- the **gallery**: one card per character, with its thumbnail, name, identity tags, the one-click **Active** switch, Edit and Delete (after a confirmation; its images are deleted, outputs made with it are kept);
- **Reference images (IP-Adapter)**: whether reference images can be used with the selected model for each focus (the reason when they cannot, with Download for a missing IP-Adapter, its progress and Cancel), every IP-Adapter variant with the status of each file (On disk, Downloading, Available to download), and the two folders.

The **Character section of the Generation pane** (right under the actions) shows the active character: thumbnail, name, tags, seed lock, Deactivate, its reference strength and whether its references apply with the selected model. Without one, it offers a dropdown to activate a character and "New character". One character at most is active; the backend saves which one.

How the active character takes part in a generation (the precedence is documented once, at the top of `frontend/src/domain/characters.ts`):

1. Its identity tags are the locked sub-prompt of a pinned **'Character'** category, its outfit tags the locked sub-prompt of a pinned **'Character outfit'** category. The prompt engine selects them before every user category, whatever the priorities; they never use a cycle counter and draw nothing from the prompt seed, so the same prompt seed still picks the same user sub-prompts. They appear in the Used sub-prompts pane and the output metadata like any category (locked), so forbidden rules can be created with them.
2. Forbidden rules: the character wins. A user sub-prompt forbidden together with the identity or the outfit is never chosen (another one of its category is, or the category is skipped), and category cards show it as indirectly disabled. The outfit is skipped when a rule forbids it together with the identity.
3. The character's tags can trigger the activation text of user categories.
4. Its negative tags are appended to the negative prompt, except those already in it.
5. LoRAs: the character's LoRAs come first with their weights, then the selected LoRAs, then the prompt-linked ones. A LoRA both in the character and in the selection uses the character's weight. Character LoRAs missing from the library are skipped with a warning, like selected ones.
6. A locked seed replaces the image seed whatever the image seed behavior, and the seed field is left unchanged; the prompt seed and the cycle counters advance as usual.
7. Reference images: the request names the character (`character_id`) and the backend applies its reference images through the IP-Adapter for the model's family and the character's focus. When they cannot apply (no reference image, a model family without IP-Adapter, the IP-Adapter not on disk), generation runs without them and the output records why.
8. If a user category already has the key 'character' (or 'character-outfit'), the pinned one is renamed ('character-2'). Rules naming 'Character' then target the user category.

IP-Adapters:

- Four variants from [h94/IP-Adapter](https://huggingface.co/h94/IP-Adapter), pinned to one revision (`backend/app/services/ip_adapters.py`): SD 1.5 face (IP-Adapter Plus Face), SD 1.5 general (IP-Adapter Plus), SDXL face (IP-Adapter Plus Face ViT-H) and SDXL general (IP-Adapter Plus ViT-H). All four use the same ViT-H image encoder (`CLIP-ViT-H-14-laion2B-s32B-b79K.safetensors`, 2.5 GB), downloaded once. The SD 1.5 adapters are about 98 MB, the SDXL ones 848 MB.
- The model's family (SD 1.5 or SDXL) is read from the checkpoint header without torch (`diffusion_lora_runtime.pipeline_architecture`), and with the character's focus picks the variant. Other families cannot use reference images.
- Files already in ComfyUI's `models/ipadapter` and `models/clip_vision` folders are reused, found by name and size, or by SHA-256 when renamed (the first install hashes them once). Missing files are downloaded on request (Download), through the same download manager as the model library: verified by size and SHA-256, with progress and Cancel; no token is sent.
- The runtime loads, swaps and unloads IP-Adapters and changes their scale without reloading the model. The image encoder is read once and reused while its file stays the same. A missing or unreadable reference image fails the generation with a clear message before anything is loaded.

Storage: `<data dir>/characters/characters.json` (`{"version": 1, "active_id", "items"}`) and one PNG per image in `<data dir>/characters/images` (reference images at most 1024 px on the long side, thumbnails at most 384 px, EXIF orientation applied). Invalid entries are skipped. A characters file that cannot be read, or has another version, is reported as an error (HTTP 503) and never overwritten.

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
- Category cards highlight the sub-prompts forbidden together with the selected association source in red, or purple when a lock is involved (the active character's 'Character' and 'Character outfit' prompts count as locked).

### Seeds

- The prompt seed drives which sub-prompts are chosen. The image seed drives the diffusion. An empty seed field means a random seed.
- After each generation, each seed field follows its behavior:
  - `Fixed`
  - `Auto increment`
  - `Randomize`
  - `Per-category cycle (random restart)` (prompt seed only)
- An active character with a locked seed replaces the image seed and leaves the image seed field unchanged (see Characters).

### Outputs

- Every generation is saved in `<data dir>/output` under a fixed-width 10-digit number: `0000000001.png` + `0000000001.json`.
- After a generation, the UI jumps to the newest output.
- The arrow keys move through the output history: left/up goes to the previous output, right/down to the next. They are left to the focused control when it uses them itself (text fields, window handles, menus, dropdowns, the app bar); click elsewhere to browse again. The Output browser pane offers First / Previous / Next / Last buttons.
- For the current output, the Output browser shows its number and position, image name, size, steps, CFG, seed, prompt seed, model and LoRAs with their weights (`name (weight)`); the Used sub-prompts pane lists each category with its chosen sub-prompt. "Copy prompt" (Output browser and Generation pane) copies the full prompt.
- The metadata JSON lists the LoRAs used as `active_loras: [{"id", "weight"}]`. Files written before LoRA weights existed (`active_lora_ids`) still load, with weight 1; they are not rewritten.
- An output made with an active character has a `character` key: `{"id", "name", "reference": {"applied", "variant_id", "strength", "image_ids", "reason"}}`, where `reason` says why the reference images were not applied. Outputs made without a character have no such key (the API answers `character: null`), so older outputs load unchanged. The Output browser shows it as a 'Character' row, and has "Create character" (see Characters).
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
        health, bootstrap, outputs, generation, tasks, stores,
        models, model_installs, downloads, images, characters, ip_adapters,
        provider_errors (provider error -> HTTP status)
      services/            domain logic and IO, constructed with injected paths
        container.py       build_services -> AppServices
        json_files.py      crash-resilient JSON files (.new/.old sidecars)
        http.py            the only place that builds outgoing httpx clients (HttpClientFactory), describe_http_error
        files.py           small filesystem helpers (remove_quietly)
        backend_settings.py  backend_settings.json: provider API tokens (never leave the backend)
        model_providers/   ModelProvider / ImageProvider protocols + shared install rules (base.py), registries,
                           civitai.py (models), civitai_images.py (image feed and galleries),
                           civitai_image_meta.py (image generation metadata -> params and resources)
        model_catalog.py   provider info, search, version / by-hash lookups annotated with local copies
        image_library.py   image search (feed, keyword -> models -> galleries, opaque cursor), resource resolution
        image_favorites.py favorite images (image_favorites.json)
        downloads.py       generic DownloadManager (.part, SHA-256, retry/resume, cancel, dedupe, progress)
        file_hashes.py     streamed SHA-256, persistent hash cache, the one SHA-256 normalization
        local_models.py    download targets and "already on disk" detection (by path and by hash), per kind or folder
        characters.py      CharacterStore: characters.json, image imports (output, file, URL), active character
        ip_adapters.py     IP-Adapter catalog (h94, pinned), on-disk status, the support rule, installs
        model_installs.py  install = find on disk or download; ModelSource provenance; display names
        legacy_state.py    app_state.json / library.json (read-only seeds)
        outputs.py         output ids, metadata, images, trash/restore
        persisted_stores.py  frontend store files, legacy Electron formats included
        task_hub.py        latest event per task + WebSocket fan-out
        generation.py      generation orchestration, GeneratorPort, character references (ReferenceInput)
        runtime_adapter.py the only importer of the diffusion_lora_runtime generator (loaded lazily)
        signals.py         Ctrl+C cancels, second Ctrl+C exits
    openapi.json           committed OpenAPI snapshot
    tests/                 pytest + TestClient on temp dirs with a fake generator and a fake network
                           (support.py: FakeHttp, StubProvider, StubImageProvider, CatalogStub, FakeDownloadManager,
                           the tiny IP-Adapter catalog; fixtures/civitai, fixtures/huggingface: real answers;
                           fixtures/characters: a version 1 characters file)
    run_backend.py
  frontend/
    electron/              main.cjs (backend start, window, dialogs), preload.cjs (bridge), ipcChannels.cjs,
                           shortcutMenu.cjs (menu from keymap.json), windowTheme.cjs (Fluent background),
                           externalLinks.cjs (web links open in the system browser) + tests
    scripts/               apiTypes.mjs + generate-api-types.mjs (npm run gen:api)
    src/
      api/                 schema.gen.ts + defaults.gen.ts (generated), types.ts, config.ts (URLs), client.ts,
                           taskSocket.ts
      persistence/         persist.ts (the one persistence mechanism), storeBackend.ts, storeNames.ts
      domain/              pure logic: text, guards, categories, forbiddenRules, reachability, promptEngine,
                           seeds, library, loraSelection, generationRequest, outputs, layout, legacyImport, paths,
                           modelCatalog, imageLibrary, characters (prompt injection), characterDrafts (editor form)
      stores/              one zustand store per domain (see "Frontend stores" below), pagedSearch.ts (the search
                           engine of the online catalogs), clipboardActions.ts, flags.ts (busy flag records)
      features/            thin Fluent views per feature (categories, forbidden, generation, library, models, images,
                           outputs, characters)
      workspace/           Workspace shell, FloatingPane, app bar, paneRegistry.tsx (PANES)
      ui/                  shared views and hooks: boot screen, error boundary, notifications host, PaneLayout, keyboard
                           hints, useInfiniteScroll, spinButtonValue, ConfirmDialog
      app/                 App, providers + theme, keymap.json, commands.ts, global shortcuts
      services/            desktop bridge (Electron preload) and clipboard
      test/                Vitest setup, render and dialog helpers, IntersectionObserver stub, model, image library and
                           character test data, character store doubles for view tests
    __mocks__/zustand.ts   resets every store between tests
  launcher/
    src/prompt_weaver_launcher/cli.py
```

### Single sources of truth

- **Shared data types.** `backend/app/schemas.py` is the truth. From `frontend/`, run `npm run gen:api` to export the OpenAPI document to `backend/openapi.json` and generate `frontend/src/api/schema.gen.ts` from it. The frontend imports named aliases from `src/api/types.ts`; never hand-write a TypeScript mirror. Two tests fail when either generated file is stale: `backend/tests/test_openapi_snapshot.py` and `frontend/src/api/apiTypes.test.ts`.
- **Shared defaults.** Defaults needed on both sides are defined once, in a `schemas.py` model decorated with `@export_defaults`: `GenerationDefaults` (size, steps, CFG, negative prompt, seed behaviors, torch dtype), `ModelSearchQuery`, `ImageSearchQuery` (provider, sort, period, NSFW off, locally usable only, page size), `LoraWeightDefaults` (weight 1, range -10..10, step 0.05) and `ReferenceDefaults` (character reference strength 0.6, range 0..1, step 0.05, focus face, at most 4 images). `npm run gen:api` writes their values to `frontend/src/api/defaults.gen.ts` (`GENERATION_DEFAULTS`, `MODEL_SEARCH_QUERY_DEFAULTS`, `IMAGE_SEARCH_QUERY_DEFAULTS`, `LORA_WEIGHT_DEFAULTS`, `REFERENCE_DEFAULTS`), and the frontend derives its own defaults from them: `DEFAULT_GENERATION_SETTINGS` in `src/domain/generationRequest.ts`, `DEFAULT_CATALOG_FILTERS` in `src/domain/modelCatalog.ts` and `DEFAULT_IMAGE_FILTERS` in `src/domain/imageLibrary.ts`. The staleness test covers this file too.
- **LoRA weights.** One representation end to end: `LoraWeight {id, weight}` (`schemas.py`). The LoRA selection (`libraryStore.selectedLoras`), the character LoRAs (`Character.loras`), the generation request (`GenerationLoRA` = library entry + weight), the output metadata (`active_loras`) and the runtime call (`LoRASpec.weight` of `diffusion-lora-runtime`) all use it. The frontend clamps weights only with `clampLoraWeight`, merges character, selected and prompt-linked LoRAs only in `resolveLoraSelection` (`src/domain/loraSelection.ts`), and formats weights (and the reference strength) only with `formatWeight` (`src/domain/text.ts`) / `weightedLorasText`.
- **Inline LoRA syntax** (`<lora:name:weight>`) belongs to `diffusion_lora_runtime.prompt_lora` (`extract_prompt_lora_specs`, `strip_prompt_lora_tags`), which imports without torch: the image library reads the prompts of online images with it.
- **Online image metadata.** Parsing Civitai's image metadata and merging its model lists is backend-owned (`civitai_image_meta.py`); the frontend only reads `RemoteImage.resources` and `ImageGenerationParams.clean_prompt`. Splitting a prompt into tags (`splitPromptTags`) and joining tags back into prompt text (`joinPromptTags`, also used for trigger words) live in `src/domain/text.ts`.
- **Window geometry and category priority defaults** belong to the frontend (default layouts in `paneRegistry.tsx`, the categories domain). The legacy `app_state.json` fields are nullable on the backend and carry no defaults.
- **Model folders and data dir layout.** `backend/app/settings.py` (`DEFAULT_MODELS_ROOT`, `MODEL_KIND_SUBDIRS`, `AppPaths`); the UI shows the folders reported by `GET /api/models/info`.
- **Model library rules** are backend-owned and only read by the frontend: which file of a version gets installed (`RemoteModelVersion.default_file_id`), whether it can be installed (`unavailable_reason`), the display name of an install (`InstalledModel.name`, the download task title), the base model -> architecture mapping and the NSFW level rule (`model_providers/civitai.py`), and file hash normalization (`services/file_hashes.py`: `normalize_sha256` for SHA-256, `normalize_file_hash` for the short Civitai hashes too).
- **Downloads.** Every model file, including the LoRAs and checkpoints of "Use these LoRAs" / "Use this checkpoint", is installed through one flow: `modelCatalogStore.install` -> `POST /api/models/install` -> `DownloadManager`. IP-Adapter files go through the same `DownloadManager` (`ipAdapterStore.install` -> `POST /api/ip-adapters/{variant_id}/install`). "Already on disk" (by name and size, or by hash) has one owner, `services/local_models.py` `LocalModelFiles`, used per model kind and per IP-Adapter folder; in the UI, the label, color and icon of each file status ('On disk', 'Downloading', ...) have one owner, `features/models/VersionStatusBadge.tsx`.
- **Characters.** The data shape is `schemas.py` (`Character`, `CharacterDraft`, image sources, `OutputCharacter`); storage, ids, image imports and the active character belong to `services/characters.py` (`CharacterStore`); the frontend mirrors them in one store, `charactersStore`. Their injection into prompt building and its precedence belong to `src/domain/characters.ts`; the editor form, its validation and the prefills from an output or an image to `src/domain/characterDrafts.ts`. An image's LoRAs as library entries with weights are collected once, by `imageLibraryStore.collectImageLoras`, for both "Use these LoRAs" and "Create character".
- **IP-Adapters.** The catalog (Hugging Face repo, pinned revision, file names, sizes, SHA-256, variants per family and focus) and the rule "can reference images apply with this model and focus, and why not" belong to `services/ip_adapters.py`; both the UI (`GET /api/ip-adapters`) and generation use that one rule, and `ipAdapterStore` never computes support itself. Which pipeline family the runtime loads a model as belongs to `diffusion_lora_runtime.pipeline_architecture` (torch-free; the runtime's own loader uses it too). The runtime request is `IPAdapterSpec`, built only in `services/runtime_adapter.py`.
- **Host and ports.** `config/defaults.json` is read by the launcher, `backend/run_backend.py` and `config/appConfig.cjs` (Vite and Electron). The frontend builds every backend URL in `src/api/config.ts`.
- **Frontend state.** Each domain has exactly one zustand store that owns its state and actions (see below).
- **Untrusted values.** Persisted and imported data is validated through `src/domain/guards.ts`; lists of backend enum values (seed behaviors, torch dtypes) are exhaustive typed records, so the type-check fails when the schema changes.

### Frontend stores

The frontend is organized around zustand stores, one per domain. Each store is the single holder of its domain's state and owns its actions: API calls, WebSocket handling, persistence and cross-store coordination (`useOtherStore.getState().action()`) happen in store actions, never in components. Pure algorithms live in `src/domain` and are unit-tested; derived data is computed by selectors and memoized hooks, never stored twice. Components are thin views: they subscribe with fine-grained selectors, call actions, and keep only ephemeral UI state (an edit draft, an open dialog, the rect during a drag). Store logic is tested without rendering.

| Store | Owns | Persisted as |
| --- | --- | --- |
| `categoriesStore` | categories and sub-prompts (`addSubPromptWithText` for tags from the image library); reachability ("indirectly disabled") hooks, which include the active character's pinned categories | `categorie-store` |
| `forbiddenRulesStore` | forbidden rules, the association source of the Used sub-prompts pane, highlights (the active character's prompts count as locked) | `forbidden-associations-store` |
| `libraryStore` | models, LoRAs (with model library provenance), the model selection and the LoRA selection with weights (`selectedLoras`), file dialogs, registration of installed models | `library-store` (version 2) |
| `modelCatalogStore` | model library: provider info, search filters, results and paging, picked versions, installs in progress, provider token updates. `install(model, version, fileId, {select, announce})` resolves to an `InstallOutcome` (installed + library entry, failed, cancelled, refused); a second install of a running install joins it | - |
| `imageLibraryStore` | image library: search filters, results and paging, the image in the detail view, the resolution of each image's models, running "Use these LoRAs" and checkpoint switches, favorites (read from and saved to the backend); `collectImageLoras` (an image's LoRAs as library entries with weights, shared with "Create character") | - |
| `charactersStore` | the frontend copy of the backend-owned characters (`/api/characters`) and the active character (`activeId`), the character editor (form, and the images a new character will import), busy flags; actions: load, setActive / toggleActive, startCreate / startCreateFromOutput / startCreateFromImage / startEdit, form and form-LoRA edits, saveEditor, remove, reference images (current output, file, remove, thumbnail), setReferenceStrength | - (the backend saves characters and `active_id`) |
| `ipAdapterStore` | the IP-Adapter status read for the selected model (variants, files on disk or downloading, reference support per focus) and running installs; actions: refresh (views call it when they show reference support and when the selected model changes), install (follows the downloads through the tasks store), cancelInstall | - |
| `generationSettingsStore` | size, steps, CFG, negative prompt, seed inputs and behaviors | `settings-store` |
| `generationStore` | single and continuous generations (with the active character), cancel | - |
| `outputsStore` | output ids, current output and its metadata, delete/restore, copy | `current-image-store` |
| `undoStore` | undo stack (generation steps, deletions) | - |
| `tasksStore` | latest task event per task (`/ws/tasks`), generation and download progress, `waitForTask` | - |
| `workspaceStore` | window layouts and stacking, closed panes, visibility mode; `revealPane` (shows a pane and brings it to the front, e.g. the Characters pane when "Create character" opens the editor) | `workspace-store` |
| `notificationsStore` | user-facing errors, warnings and confirmations | - |
| `sessionStore` | boot: bootstrap, hydration of every persisted store, legacy seeding, resuming running installs, loading the characters in the background (never delays or fails boot; a failure shows in the Characters pane with Retry) | - |

Copying text with a notification goes through one action module, `src/stores/clipboardActions.ts` (`copyTextWithFeedback`), used by the outputs, model catalog and image library stores. Busy / running flag records (`Record<id, true>`) are updated with `withFlag` (`src/stores/flags.ts`). The two online catalogs share one search engine, `src/stores/pagedSearch.ts` (debounced query, abort of the previous request, stale answers ignored, pages appended without duplicates).

Persisted stores are declared with `persistedStoreOptions` (`src/persistence/persist.ts`) and their names come from `src/persistence/storeNames.ts`; a shape change bumps the store version and adds a `migrate` with a test.

### Persistence

- The backend persists the frontend stores at `<data dir>/stores/<name>/state.json`, through `GET/PUT/DELETE /api/stores/{name}`. Each file holds the zustand envelope `{"state": ..., "version": n}`. The formats written by the former Electron storage still load: JSON `null`, a legacy string map, and legacy flat `<name>.json` files. A file that exists but cannot be read is reported as an error rather than treated as empty, so it is never overwritten.
- `src/persistence/persist.ts` is the only persistence mechanism. It hydrates stores explicitly at boot, ignores writes until a store has been read, coalesces writes, and runs legacy merge migrations.
- On first start, stores without persisted data are seeded from the legacy `app_state.json` and `library.json`, which `GET /api/bootstrap` returns (LoRA references missing from the library are stripped). The app no longer saves its state to these two files: `library.json` is a read-only seed, and the library lives in `library-store`.
- `library-store` is version 2: entries may carry a `source` (model library provenance), and the LoRA selection is `selectedLoras: [{id, weight}]`. Older data migrates on load: version 0 entries get `source: null`, and the `selectedLoraIds` of versions 0 and 1 become `selectedLoras` at weight 1. The `last_lora_ids` of a legacy `app_state.json` seed the selection at weight 1 too.
- The backend owns the favorite online images (`<data dir>/image_favorites.json`, version 1) and the characters (`<data dir>/characters/characters.json`, version 1, plus `characters/images/*.png`; see Characters).
- The frontend reads outputs through the backend API: `/api/outputs`, `/api/outputs/{id}`, `/api/outputs/{id}/image`, `/api/outputs/{id}/trash` and `/api/trash/{id}/restore`.

### Extension points

- **New panes:** add or extend a store in `src/stores` (logic in `src/domain`), then the view in `src/features/<area>` (using `src/ui/PaneLayout.tsx`), then one entry in `frontend/src/workspace/paneRegistry.tsx`. The app bar gets its show/hide toggle automatically.
- **New API areas:** add `backend/app/routers/<area>.py` exposing an `APIRouter`, append it to `ROUTERS`, put its logic in a service wired in `services/container.py`, add its models to `schemas.py`, then run `npm run gen:api` and add the client calls to `src/api/client.ts`.
- **Background tasks:** progress events form one discriminated union, `TaskEvent` = `GenerationTaskEvent | DownloadTaskEvent`, keyed by `task_id` and published through `TaskHub.publish` from any thread. The frontend reads them from `tasksStore` (`useDownloadProgress`, `waitForTask`).
- **Downloads:** `services/downloads.py` `DownloadManager.start(DownloadSpec(url, dest, title, headers, expected_sha256, expected_size), on_complete=...)` is generic: any feature that needs a file gets streaming, verification, retries, cancel (`POST /api/downloads/{task_id}/cancel`) and progress events.
- **Model providers:** implement the `ModelProvider` protocol of `services/model_providers/base.py` (`info`, `search`, `get_version`, `find_by_hash`, `download_source`; run every version through `complete_version` so the shared install rules apply) and add it to the registry in `services/container.py`. A Hugging Face provider would plug in there; the API, the install flow and the UI take the provider id from `GET /api/models/info`.
- **New shortcuts:** add the command to `APP_COMMANDS` and its handler in `src/app/commands.ts`, and the binding to `keymap.json` (a test checks both agree).
- **Image providers:** implement the `ImageProvider` protocol (`search_images(ImageFeedRequest)`, parsing the images' generation data into `RemoteImage.params` / `resources`) with the id of the model provider that resolves its images' models, and add it to the image provider registry in `services/container.py`.

### Model library API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/models/info` | providers (types, base models with their local architecture or null, sorts, `token_set`) and the model folders |
| `GET /api/models/search` | one result page (`provider`, `query`, `kinds`, `base_models`, `sort`, `nsfw`, `limit` 1-100, `cursor`); files carry `local_path` when a local copy is known |
| `GET /api/models/providers/{provider}/versions/{version_id}` | one model version |
| `GET /api/models/providers/{provider}/by-hash/{sha256}` | the version whose file has this SHA-256 (any case; the route takes 64-hex SHA-256 only, the image library also resolves short Civitai hashes internally) |
| `PUT /api/models/providers/{provider}/token` | `{"token": "..."}` stores the API token (whitespace stripped); `null` or `""` removes it; answers the provider info |
| `POST /api/models/install` | `{"provider", "version_id", "file_id"?}`: `installed` + `InstalledModel` (kind, name, path, source) when the file is on disk, else `downloading` + `task_id`. Call it again when the task completes: it then answers `installed` from the hash cache |
| `GET /api/models/installs` | installs whose download is still running (resumed by the UI after a reload) |
| `POST /api/downloads/{task_id}/cancel` | cancels a running download (404 when unknown or finished) |

Errors: 404 for an unknown provider, model, version or hash; 403 when Civitai needs a token or rejected it; 502 for a network failure or an unexpected Civitai answer (its error text is quoted, at most 300 characters); 409 for a file that cannot be installed (unsupported base model, pickle file, unknown file) or a token for a provider that takes none; 422 for invalid parameters.

### Image library API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/images/search` | one page of images (`provider`, `query`, `sort`, `period`, `nsfw`, `usable_only`, `limit` 1-100, `cursor`), each with its generation parameters and models (`resources`: kind, name, weight, version id, hash). An empty `query` reads the feed; a keyword reads the galleries of the matching models. `next_cursor` is opaque; a page may be short, or even empty while `next_cursor` is set: keep paging until it is null |
| `POST /api/images/resolve` | `{"provider", "resources"}`: one entry per resource, in order: the identified model version (with `local_path` when a local copy is known) and its `sha256`, or an `error` (a failure of one resource never fails the request) |
| `GET /api/images/favorites` | the favorite images, newest first |
| `PUT /api/images/favorites` | saves an image (`RemoteImage`) as a favorite, or moves it to the front |
| `DELETE /api/images/favorites/{provider}/{image_id}` | removes a favorite (404 when it is not one) |

Errors: 422 for invalid parameters or a cursor this backend did not produce; 404 for an unknown provider; 403 / 502 from Civitai as above. A model gallery Civitai no longer knows is skipped.

### Characters API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/characters` | every character in creation order, and `active_id` |
| `POST /api/characters` | creates a character (`CharacterCreateRequest`: the fields plus up to 4 `reference_sources`); all or nothing; the first reference image also becomes the thumbnail |
| `PUT /api/characters/active` | `{"id": "chr-..."}` activates a character, `{"id": null}` deactivates; answers the collection |
| `PUT /api/characters/{id}` | replaces the editable fields (`CharacterDraft`); images are kept |
| `DELETE /api/characters/{id}` | deletes the character and its images, and deactivates it |
| `POST /api/characters/{id}/reference-images` | `{"source": ...}` imports one more reference image (a thumbnail is made when there is none) |
| `DELETE /api/characters/{id}/reference-images/{image_id}` | removes a reference image (the thumbnail stays) |
| `PUT` / `DELETE /api/characters/{id}/thumbnail` | sets the thumbnail from a source, or removes it |
| `GET /api/characters/{id}/images/{image_id}` | a reference image or the thumbnail (`image/png`) |

Image sources (`kind`): `output` (an output's image), `file` (a PNG, JPEG, WebP or BMP file), `url` (at most 25 MB; error messages never quote the URL's query) and `character_image` (a copy of one of the character's images, e.g. for the thumbnail; refused when creating). A generation request names the active character with `character_id` (409 for an unknown character).

Errors: 404 for an unknown character, image, output or file; 409 when a character already has 4 reference images; 422 for an invalid body (e.g. a locked seed without a seed) or a file that is not a supported image; 502 when an image URL cannot be downloaded; 503 when `characters.json` cannot be read (it is then never overwritten).

### IP-Adapter API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/ip-adapters?model_path=` | every IP-Adapter variant with its files (`local_path` when on disk, `task_id` while downloading) and `ready`, the two folders, and for `model_path` its family (`architecture`) and one `ReferenceSupport` per focus (`variant_id`, `ready`, `reason` when references cannot apply) |
| `POST /api/ip-adapters/{variant_id}/install` | `installed` when every file is on disk, else `downloading` with one task id per missing file (progress on `/ws/tasks`, cancel with `POST /api/downloads/{task_id}/cancel`); 404 for an unknown variant |

## Stack

- Backend: FastAPI, Pydantic v2, uvicorn, Pillow, httpx (outgoing HTTP), `diffusion-lora-runtime` (editable path dependency), managed with `uv`, tested with pytest.
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

Tests never touch the real data directory, the model folders or the network, and never load a real model. The backend tests point `PROMPT_WEAVER_DATA_DIR` and the model folders at a temp dir and use a fake generator. Every outgoing request is answered by `FakeHttp` (real trimmed Civitai answers live in `tests/fixtures/civitai`), and any other request to a non-loopback host fails the test. No model, GPU or network is needed.

```powershell
cd backend
uv run pytest              # 714 tests: API tests (TestClient), service unit tests, the download manager against a
                           # local HTTP server, and the install, image library and character flows end to end

cd frontend
npm test                   # 1004 Vitest tests: domain, stores, persistence, API client, components, Electron helpers
npm run typecheck          # tsc -b
npm run build              # type-check + production bundle
npm run gen:api            # regenerate backend/openapi.json, src/api/schema.gen.ts and src/api/defaults.gen.ts
                           # after changing schemas.py

cd D:\Anything\libs\diffusion-lora-runtime
uv run --extra dev pytest -q tests
                           # runtime lib (109 tests: torch, diffusers and transformers are stubbed and the pipeline is
                           # a recording fake; one subprocess test runs the IP-Adapter code with the real libraries on a
                           # tiny random CPU pipeline built from configs, and skips itself when they are missing)
```

If `VIRTUAL_ENV` points at another virtual environment, unset it before running `uv` commands in `backend/`.

## Notes and constraints

- Model loading expects a Diffusers-compatible model directory or a checkpoint supported by `diffusion-lora-runtime`. Single-file `.safetensors` checkpoints are identified from their header:
  - SD 1.x (`cond_stage_model.transformer.*` tensors) loads with `StableDiffusionPipeline`;
  - SDXL, Pony, Illustrious and NoobAI (`conditioner.embedders.1.*` or `model.diffusion_model.label_emb.*`), and anything not identified (`.ckpt`, SD 2, unknown), load with `StableDiffusionXLPipeline` as before.
  - Both use the same sampler and v-prediction settings.
- The first load of an SD 1.x single-file checkpoint lets Diffusers fetch the SD 1.5 pipeline config and tokenizer files from the Hugging Face Hub, unless they are already cached (SDXL already did this for its own config).
- On SD 1.x models the prompt is plain text: Diffusers truncates it at 77 tokens (long-prompt chunking is SDXL only). Embeddings work on SD 1.x with their CLIP-L vectors.
- New checkpoint entries, installed SD 1.5 checkpoints included, get the current generation size as their default size: set 512 x 512 (or 512 x 768) yourself for SD 1.5.
- A LoRA entry can point to either a file or a directory.
- Reference images need an SD 1.5 or SDXL model (Pony, Illustrious and NoobAI are SDXL). The first generation with reference images reads the 2.5 GB image encoder; later ones reuse it.
- The shared `diffusion-lora-runtime` package (0.4.0) handles runtime model loading, incremental LoRA loading (with per-LoRA weights), IP-Adapters (`IPAdapterSpec`, ComfyUI single-file or folder image encoders), inline prompt LoRA resolution, textual-inversion resolution and KSample mapping. The backend imports its generator on the first generation only, because that loads torch; its `prompt_lora` module (the inline LoRA syntax) is torch-free and used at any time.
- Civitai rate-limits and sometimes slows down its public API; the image library shows such failures with a Retry button. With "Only locally usable models" on, Civitai is asked for images of loadable base models only, but it may still return images whose base model is unknown: they show "Not supported locally", and models the runtime cannot load are never installed.
- Width, height, steps and CFG stay user-editable in the UI.
