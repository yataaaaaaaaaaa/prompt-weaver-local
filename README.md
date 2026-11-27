# Prompt Weaver Local

A local, Windows-first desktop tool for prompt-combinator diffusion generation.

## What it does

- Runs fully locally: a FastAPI backend drives the shared `diffusion-lora-runtime` package, and an Electron + React desktop UI built with Fluent UI 2 talks to it.
- Organizes the work in five docked task sections on a navigation rail: **Create** (prompt board, current image, generation panel), **Models**, **Images**, **Characters** and **Story**, with one-click hand-offs between them.
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
- Has story mode, an illustrated storyboard: a story is an ordered list of scenes, each with a title, its text and a picture generated through the same prompt engine and generation path (the prompt board, the story's characters, the LoRAs with their weights, the current model and settings) plus per-scene overrides (extra tags, locked sub-prompts, its own characters, a fixed seed, negative tags). Keep every variant of a scene and pick its picture, generate every missing scene in one click, read the story as a picture book and export it as one HTML file.
- Has a co-writer in story mode: the user's own installed OpenAI Codex (their Codex app and its login, no API key) docked in the Story section as a chat panel. It can do everything story mode needs, from character consistency (create and edit characters, their LoRAs, seeds and reference images, check the scenes against them) to the story's flow (a logline, synopsis, style notes and the whole outline in one call; scenes added, reordered, rewritten) to per-frame tags (tags, negative tags, locked sub-prompts, LoRAs with weights, seeds and casts for many scenes at once), previews of the exact prompts, pictures, a look at the pictures and a consistency report: it acts on the app through the app's own tools, and the storyboard shows every change as it happens.
- Saves every generation as an image plus an adjacent JSON metadata file in `<data dir>/output`.
- Keeps everything else in the data directory too: frontend state (`<data dir>/stores`), the app-managed trash (`<data dir>/trash`), backend settings such as the optional Civitai API token (`<data dir>/backend_settings.json`), the file hash cache (`<data dir>/cache/file_hashes.json`), the favorite online images (`<data dir>/image_favorites.json`), the characters and their images (`<data dir>/characters`), the stories (`<data dir>/stories`), the co-writer's conversations index and its empty working directory (`<data dir>/codex`) and the legacy `app_state.json` / `library.json`.

The data directory is `D:\Anything\storage\prompt-weaver-local-storage` on Windows, or `<repo>/.prompt_weaver_local_data` on other systems. Set the `PROMPT_WEAVER_DATA_DIR` environment variable to use a different one. The backend owns this layout in `backend/app/settings.py`.

Model files live in the ComfyUI models folder, `D:\Anything\ComfyUI\ComfyUI\models` (`DEFAULT_MODELS_ROOT` in `backend/app/settings.py`), in its `checkpoints`, `loras` and `embeddings` sub-folders (`MODEL_KIND_SUBDIRS`). Model library downloads go there, and inline LoRA tags and embeddings in prompts are resolved from there. The IP-Adapter files of character reference images use the ComfyUI folders too: adapters in `ipadapter` (`IP_ADAPTER_SUBDIR`), image encoders in `clip_vision` (`IMAGE_ENCODER_SUBDIR`).

## Current behavior

### Sections and layout

The app follows the journey Discover -> Collect -> Compose -> Generate -> Review -> Reuse -> Tell in five task sections, all docked (nothing floats or overlaps):

- **Navigation rail** on the left: **Create** (compose prompts, generate and review outputs), **Models** (find, download and pick checkpoints, LoRAs and embeddings), **Images** (find online images and reuse their LoRAs, tags and checkpoint) **Characters** (keep the same character across generations) and **Story** (illustrate a story scene by scene and read it as a picture book). `Ctrl+1`..`Ctrl+5` show them; each item's tooltip says what the section is for, with its shortcut. The Models item has a badge with the number of running downloads. A section loads on its first visit and keeps its state when you switch away.
- **Bottom of the rail:**
  - **Downloads**: the overall progress while files download. Its popover lists every running download, whatever started it (Models installs, "Use these LoRAs", IP-Adapter files), with its progress, and offers "Show in Models"; when idle it says "No downloads running."
  - **About**: the data directory ("Data directory: ...") and the backend address.
- **Create** has a command bar on top and three docked regions side by side, left to right: **Prompt board** | **Current image** | **Generation**.
  - The **command bar** ("Generation inputs") shows the current model, the active character and the LoRA count, each one click from changing it: Model (or "No model") opens the Checkpoint picker with Add model file and Browse models; Character (or "No character") opens a menu with None, the characters (the active one checked), New character and Manage characters; "N LoRAs" opens the weight of each selected LoRA and Edit LoRAs (expands the generation panel at its LoRA list). It fits on one row at 1280 px: long names are truncated, with the full name in the tooltip.
  - Next to it, the **Layout** toolbar has one toggle per region (pressed while the region is expanded) and "Cycle the Create layout" (`Ctrl+H`).
  - The board takes the remaining width. When the window is small, the image shrinks first, then the generation panel, so everything fits at 1280 x 720 without horizontal scrolling. Minimum widths: board 320, image 320, generation 300 px; maximums: image 1400, generation 640 px (defaults 560 and 380).
  - **Splitters**: drag the boundary on the left of the image or of the generation panel to resize it (the board gives or takes the room). With the keyboard, focus the splitter ("Resize Current image", "Resize Generation"): `←` / `→` 16 px, with `Shift` 64 px, `Home` / `End` the minimum / maximum, `Enter` collapses that region.
  - **Collapse**: a collapsed region becomes a 56 px strip with an Expand button and its vertical name. The collapsed generation strip keeps Generate, Continuous and Cancel (icon-only, with tooltips) and a small progress bar. At least one region always stays expanded.
  - `Ctrl+H` (and "Cycle the Create layout") cycles: everything -> the board alone -> image + generation panel -> everything. From another section it shows Create.
- **Models**, **Images**, **Characters** and **Story** are full pages built the same way (`src/ui/SectionLayout.tsx`): a header with the section title and its toolbar (search, filters, commands), the results grid, and a detail panel next to it for the selected item. The layout can also dock a navigation pane before the results (Story: the list of stories) and a side panel after the detail panel (Story: the dock, where the co-writer is plugged in). The dock collapses to a 48 px strip with an Expand button and its vertical name (the detail panel takes the room back, the panel keeps its state); collapsing moves the focus to Expand, expanding moves it to the dock. Opening an item moves the focus to its heading; `Escape` or Close (X, "Close details") clears the selection and returns the focus to the card or thumbnail that opened it.
- **Keyboard**: `F6` / `Shift+F6` move the focus between regions: the rail, the Create header, the board, the image and the generation panel in Create; the toolbar, the results and the detail panel in the other sections (in Story: the toolbar, the stories, the scenes, the scene details and the co-writer dock). Each region shows a focus ring. `F6` works from any control, text fields included. `Ctrl+F` focuses the search box of the shown section (in Create, the board's search; a collapsed board is expanded first). Every icon button has a name and a tooltip, and every control a visible focus ring.
- **Toasts** appear at the bottom-end corner, above the app; while Create is shown they sit left of the generation panel, so they never cover Generate; while Story is shown with the co-writer expanded they sit left of the dock, so they never cover the message box and Send. Errors and warnings stay until dismissed; information and confirmations close after 4 s. A hand-off toast (see below) has a "Go to <section>" button, offered only while another section is shown.
- Startup shows the app name and a spinner; if the backend cannot be reached, an error card explains why and offers Retry. Delete confirmations have a red Delete button; Cancel has the initial focus, and the focus returns to the button that opened the dialog.
- The UI follows Microsoft Fluent 2 (Fluent UI React v9) and switches between light and dark to match the OS setting, live. The desktop window is at least 1280 x 720.
- Web links (Civitai model and image pages) open in the system browser, never inside the app window (`frontend/electron/externalLinks.cjs`).
- The Create layout is saved in `layout-store`: the image and generation widths, the collapsed regions, and whether the output details panel is open and which tab it shows. The board's card order and collapsed cards are saved in `board-store`. See Persistence for how both are derived once from the layouts of the former floating-window versions.

### Hand-offs between sections

Each hand-off is one click and lands in context; nothing navigates by itself:

- In Images, "Use these LoRAs", "Use this checkpoint" and "Add to category" update the Create state at once and announce it with a toast offering "Go to Create". "Add to category" also reveals that category's card on the board (expanded, unfiltered, scrolled into view).
- In Models, "Download and use" or "Use" makes a checkpoint the current model, or adds a LoRA to the selection, and announces it with "Go to Create" (the local library's "Use" too). Download progress shows on the card, in the detail panel, on the Models rail badge and in the rail's Downloads indicator, from any section.
- "Create character" on the current output (Create) or on an image's details (Images) opens the Characters editor prefilled; Cancel goes back to where it was opened, and saving offers "Go to <that section>". Activating a character outside Create offers "Go to Create".
- New character (Character section of the generation panel, command bar menu) and Edit open the editor in Characters; "Manage characters" shows the section.
- "Add to story" in the viewer's output actions (Create) adds the output shown as a new scene of the story you pick (or of a new story); the toast offers "Go to Story", which lands on the new scene. A run of "Generate missing" that completes while another section is shown offers "Go to Story" too.

### First run and empty states

Every region says what to do when it has nothing to show (the board, the viewer and the section pages share one empty-state component, `src/ui/EmptyState.tsx`):

- no model: the generation panel shows "No model yet" with **Add model file** and **Browse models** (Models section); Generate stays disabled ("Pick a checkpoint to generate");
- no categories: the board explains categories and offers **Add your first category** and **Browse images** (an online image's tags can become a category); when the search or state filter hides every card, it says so with **Clear filter**;
- no outputs: the viewer says "No outputs yet" and to press Generate (`Ctrl+G`) in the Generation panel; also "No output selected" and a picture that cannot be loaded;
- the detail panels of Models, Images and Characters say what to pick and what will show; the empty character gallery explains the three ways to create a character, each one click away.

### Models and LoRAs

- Choose the model with the Checkpoint picker of the generation panel, or from the command bar's Model button.
- The LoRA list of the generation panel ("LoRA library") has one checkbox per LoRA for the default selection, plus Clear (amber: it unselects every LoRA). LoRAs that a sub-prompt pulls in are marked "Prompt-linked". The weight fields and delete buttons line up in columns; long names are truncated, with the full name in a tooltip.
- "More options" at the end of the generation panel (collapsed by default) holds Add model file / Add model folder, Add LoRA files / Add LoRA folder, and the prompt-linked details: a summary of the default-selected, prompt-linked and possibly active counts, and "Remove prompt links to <name>", which unlinks a LoRA from every sub-prompt in one click.
- Every selected LoRA has its own weight, edited with the "Weight of <name>" spin button next to its checkbox (arrow keys step it; typed values are clamped). The range is -10 to 10 in steps of 0.05, default 1 (`LoraWeightDefaults` in `backend/app/schemas.py`). A LoRA enters the selection at weight 1 (checkbox, added files, Models installs); "Use these LoRAs" of the Images section sets the image's weights. The command bar's LoRA popover has the same weight fields. LoRAs that only a sub-prompt pulls in are applied at weight 1; a LoRA both selected and prompt-linked keeps its selected weight.
- Add models and LoRAs through Electron file and folder dialogs:
  - model files (`.safetensors`, `.ckpt`) or a Diffusers model directory
  - LoRA files (`.safetensors`, `.bin`, `.pt`, several at once) or LoRA directories
- The dialogs open in the last model folder or last LoRA folder you used. They need the desktop app; in a plain browser the app says so instead.
- Adding a model or LoRA whose path is already in the library reuses (and selects) the existing entry.
- The backend keeps the current model and its LoRAs loaded between generations. Only a different model (path, dtype, sampler or scheduler) reloads the model. LoRA changes are incremental (`diffusion-lora-runtime` 0.4.0): added LoRAs are loaded, removed ones are deleted from the pipeline, and a weight-only change just re-applies the adapter weights, so changing a weight, the LoRA set or the active character no longer reloads the model. Inline `<lora:...>` LoRAs follow the same rules; textual inversions stay loaded.
- A sub-prompt can pull in extra LoRAs (`extra_lora_ids`). Removing a LoRA from the library also unlinks it from every sub-prompt.
- The runtime resolves inline `<lora:name:weight>` tags against the ComfyUI `loras` folder and textual-inversion embeddings (`embedding:name`) against the `embeddings` folder (see the model folders above).
- Library entries installed from the model library keep their provenance (provider, model, version and file ids, SHA-256, preview image, base model, trigger words, page URL). Entries added from disk have none and show as "Local file".

### Models section

The Models section (rail item Models, `Ctrl+2`) is a full page with two views, **Online** and **Local library** (a switch at the start of the toolbar).

**Online** searches Civitai:

- Toolbar, first row: the view switch, the search box (it searches as you type; `Ctrl+F` focuses it) and "Civitai token" on the right. Second row, the filters, each label left of its control:
  - type: Checkpoint (Civitai `Checkpoint`), LoRA (`LORA`, `LoCon`, `DoRA`), Embedding (`TextualInversion`)
  - base model: SD 1.5 / LCM / Hyper, SD 1.4, SDXL 1.0 / Lightning / Hyper / Turbo, Pony, Illustrious, NoobAI. Pony V7, SD 2.1, SD 3.5 and Flux.1 D/S are listed too, marked "Not supported locally", because the runtime cannot load them.
  - sort: Most downloaded, Highest rated, Newest
  - NSFW switch: preview images with a Civitai `nsfwLevel` above 2 are hidden unless it is on
- The results are a responsive grid of compact cards, loaded page by page ("Load more"; it stays in place and keeps the keyboard focus while the next page loads, in both libraries). Each card shows the preview, name, creator and download count, the type, base model, NSFW and status badges (On disk, In library / Selected, Downloading, Failed or Not supported; the status labels are shared with the Images section and the IP-Adapter files: `frontend/src/features/models/VersionStatusBadge.tsx`), and its own action, which works without opening the detail panel:
  - "Download and use" for a file that is not on disk;
  - "Use" for a file already on disk or in the library;
  - a progress bar with Cancel while it downloads;
  - Retry / Dismiss after a failure;
  - a disabled button with the reason when the version cannot be installed.
- Selecting a model's name (or its preview) opens the **Model details** panel next to the grid: the picked version's preview, creator, downloads and badges; the version picker (it also drives what the card shows and installs); the trigger words with a copy button; the same install action with its progress, Cancel, Retry / Dismiss or reason; "Open on civitai.com"; and the version's files with their sizes, the default file marked. With nothing selected, the panel says what to pick.
- A Downloads area above the grid lists the running installs that no card shows (for example after a reload).
- Selecting a version always goes through the backend, which first looks for the file on disk: by name and size, or by SHA-256 among files of the same size anywhere under the kind's folder, so renamed or moved copies are found. A file already on disk is never downloaded again.
  - Checkpoints become the current model, and LoRAs are added to the selected LoRAs; the toast offers "Go to Create".
  - Embeddings have no library entry: the app tells you the prompt token to use (`embedding:<file name>`), and "Copy prompt token" copies it. The card shows the embedding "On disk" as soon as it is installed.
- Downloads keep running whatever section is shown; their progress shows on the Models rail badge and in the rail's Downloads indicator. After a reload, the app picks up the downloads still running in the backend.
- Only SafeTensors files (Civitai file type Model or Pruned Model) can be downloaded. Pickle files (`.pt`, `.ckpt`) are shown but refused, and so is a version whose base model the runtime cannot load.
- "Civitai token" stores an optional Civitai API token, which some downloads require. The backend keeps it in `<data dir>/backend_settings.json`. It is never sent back to the UI (only whether one is set), never logged and never included in error messages. When set, it is sent as `Authorization: Bearer` to Civitai only: it is dropped when a download is redirected to Civitai's storage host.

**Local library** shows the checkpoints and LoRAs of the library as card grids, with their provenance (preview, base model, version, trigger words) or "Local file", and their path (wrapped between folder names). "Use" on a checkpoint makes it the current model (with "Go to Create"); LoRAs have "Use by default" and Remove (red). The detail panel shows the three model folders.

At 1280 x 720 the results keep two card columns and the detail panel is 360-560 px wide.

Downloads:

- A download streams into `<target>.part` next to the target file. The file is renamed into place only after its SHA-256 and size match what Civitai published; a mismatch deletes the `.part` file and fails the download. A `.part` file left by a crash is deleted when that file is downloaded again.
- At most 2 downloads run at once; the others wait as "queued". Network errors, HTTP 5xx and 429 are retried (3 attempts, 2 s apart), resuming with an HTTP `Range` request when the server supports it. Other 4xx answers fail at once; 401/403 explain that a Civitai token is needed or was rejected.
- A file already present at the target is never overwritten: it is reported as already downloaded when it matches, and the download fails otherwise. When a different file holds the name, the download uses `<name>-<version id>` (then `-<version id>-<file id>`, then a number).
- Starting the same download twice (double click, a second window) joins the running one. Closing the app cancels running downloads and waits at most 10 s.
- Progress, completion, errors and cancellation are `DownloadTaskEvent`s on `/ws/tasks` and `GET /api/tasks`, like generation progress. Their messages never contain URLs (signed storage URLs carry credentials) or headers.
- The SHA-256 of every model file the backend hashes or downloads is cached in `<data dir>/cache/file_hashes.json`, valid while the file's size and modification time are unchanged, so later checks need no hashing. The cache is derived data and safe to delete.

### Images section

The Images section (rail item Images, `Ctrl+3`) has two views, **Search** and **Favorites**. Picking a thumbnail opens the **Image details** panel next to the grid: the grid stays, and the shown thumbnail gets a brand ring. `Escape` or Close clears the selection and returns the focus to the thumbnail. With nothing picked, the panel says "Pick an image to see its tags, LoRAs and checkpoint". The shown image stays shown when you switch between Search and Favorites.

**Search** lists Civitai images in a grid of thumbnails that loads more as you scroll (a "Load more" button does the same and keeps the focus):

- A search box (it searches as you type; `Ctrl+F` focuses it), plus:
  - sort: Most reactions, Most comments, Most collected, Newest
  - period: Day, Week, Month, Year, All time. It only applies without a keyword: it is disabled while a keyword is typed, and its hint says so (the filter row never changes height).
  - "Show NSFW" (off by default: only images Civitai rates safe, `nsfwLevel` 1-2, are shown)
  - "Only locally usable models" (on by default: only images made with a base model the local runtime can load)
- Keywords search the models' galleries. The Civitai images API has no free-text filter (it ignores `query`, and `tags` only takes numeric tag ids), so a keyword is looked up in the model catalog (the model library search: LoRAs and checkpoints, most downloaded, up to 4 models, with the usable base models when that switch is on), and the page interleaves the image galleries of those models, read through each model's newest version made for an allowed base model (Civitai answers version galleries in well under a second, whole-model galleries in up to 20 s). When those galleries run out, the next models of the search are used. An empty keyword browses the Civitai image feed with the sort and period.

**Image details**:

- the large preview, author, base model ("Not supported locally" when the runtime cannot load it), Favorite, "Copy prompt", "Create character" (see Characters) and a link to the image page on civitai.com;
- **Tags**: the prompt split into tags, inline `<lora:...>` tags removed. "Add to category" adds them, all or only the tags you select, as one new sub-prompt of the category you pick, or of a new category. A sub-prompt that already exists in that category is refused. The toast offers "Go to Create", where the category's card is revealed.
- **LoRAs**: each LoRA with its name (linked to its Civitai page once identified), its weight ("unpublished, default" when the image publishes none) and its status: In library, On disk, Available to download, Downloading (with the progress bar and Cancel of the Models section), Failed, Not supported, Not identified or Resolving; the reason is in a tooltip.
- **Use these LoRAs** makes the selection exactly the image's LoRAs, with the image's weights. LoRAs already in the library are used as they are; missing ones are installed through the model library first (same downloads, progress and checks; a download already running is joined); LoRAs that cannot be identified, downloaded or loaded are skipped with a warning listing why. When none can be used, the selection is left unchanged. The toast offers "Go to Create".
- **Checkpoint**: the checkpoint the image was made with, its status, and "Use this checkpoint", which makes it the current model, after installing it through the model library when needed (the toast offers "Go to Create").
- **Generation parameters**: prompt, negative prompt, sampler, steps, CFG, seed, size and clip skip, as published (an em dash when missing).

How an image's models are found:

- The backend reads the image metadata Civitai publishes and merges its sources into one entry per model (`backend/app/services/model_providers/civitai_image_meta.py`, rules in its docstring): `civitaiResources` (version ids and weights of images made on Civitai), `resources` (name, weight, hash), `hashes`, `Model` / `Model hash`, and the inline `<lora:name:weight>` tags of the prompt (parsed by `diffusion_lora_runtime.prompt_lora`). Types other than checkpoints, LoRAs and embeddings (VAE, upscalers...) are ignored.
- Each model is then identified by its version id, else by its file hash: Civitai's short AutoV2 (10 hex) and AutoV3 (12 hex) hashes are accepted, as well as a full SHA-256. A model published by name only cannot be identified.
- A library entry of the same kind is used when its provenance (version) or SHA-256 matches, or else when its file name without extension equals the published name (case-insensitive).

**Favorites** keeps images you mark with Favorite, newest first. The backend stores them in `<data dir>/image_favorites.json` (`{"version": 1, "items": [...]}`); unreadable entries are skipped.

### Characters

A character makes the same person appear across generations. It holds a name and a thumbnail, identity tags (appearance: face, hair, eyes, body), outfit tags (kept separate from the identity), negative tags, optional character LoRAs with their weights (the same `LoraWeight` as the LoRA selection), an optional seed that can be locked, and up to 4 reference images with a reference focus (Face or Whole subject) and a strength (0 to 1, default 0.6; `ReferenceDefaults` in `backend/app/schemas.py`).

Creating a character (each opens the editor in the Characters section):

- **New character**: the Characters toolbar (the section's primary action), the empty gallery, the Character section of the generation panel, the command bar's Character menu.
- **Create character** in the viewer's output actions (Create), prefilled from the output shown: its selections become the identity tags (a 'Character outfit' selection becomes the outfit tags), its LoRAs with their weights, its image seed (not locked); the output image becomes the first reference image.
- **Create character** in an image's details (Images section), prefilled from the image: its tags, its LoRAs with their weights (found like "Use these LoRAs": missing ones are installed first, the others are skipped with a warning), its seed; the image becomes the first reference image.

The **Characters section** (rail item Characters, `Ctrl+4`) is a full page:

- **Toolbar**: "Search characters" (`Ctrl+F` focuses it) filters by name, identity tags and outfit tags (with comma-separated terms, all must match); a count ("N characters", or "N of M characters" while searching); New character (primary).
- **Character gallery**: one card per character, sorted by name, with its thumbnail (a placeholder when it has none), an "Active" badge on the active one, name, identity tags (at most 3 lines), the one-click **Active** switch, Edit and Delete (red, after a confirmation; its images are deleted, outputs made with it are kept). Clicking a card (or `Enter` / `Space` on its picture) selects it: it gets a brand frame and its details show in the detail panel. A search that matches nothing says so, with Clear search; a load failure shows the error with Retry. The empty gallery explains the three ways to create a character, each with a button: New character; Create character from an output in Create ("Go to Create"); Create character from an image in Images ("Browse images").
- **Character details** (the detail panel):
  - while the editor is open: the **editor** (new, edit, or prefilled from an output or an image): name, identity / outfit / negative tags (comma-separated), LoRAs (pick from the library, a weight field per LoRA), seed and "Lock seed", reference focus, reference strength, reference images (a new character shows the images it will import; a saved one adds "Add current output" and "Add image file", and has "Use as thumbnail" and Remove per image; a "Thumbnail" badge marks the one used as thumbnail), and Save / Cancel, always visible at the bottom while the form scrolls. Save is disabled while a field is invalid;
  - otherwise the selected character's details: picture, name, Active badge, Activate (primary) or Deactivate, Edit, Delete, its values (tags, LoRAs with weights, seed and its lock, reference focus and strength) and its reference images;
  - with nothing selected, how to see details;
  - below, always: **Reference images (IP-Adapter)**: whether reference images can be used with the selected model for each focus (the reason when they cannot, with Download for a missing IP-Adapter, one progress bar per file and Cancel), every IP-Adapter variant with the status of each file (On disk, Downloading, Available to download, Failed), and the two folders. A failed download stays shown, naming each failed file and why, with Retry; Cancel goes back to Download without an error.
- **Focus**: the name field takes the focus when the editor opens. When it closes, the focus goes back to what opened it, also after Cancel returned to another section; after saving a character opened from elsewhere, to its Activate button; after a deletion, to the selected character's main button, otherwise to New character.
- **Hand-offs**: an editor opened from another section remembers it: Cancel goes back there. Save stays in Characters and selects the saved character (clearing a search that would hide it); its notification ("X was created." / "X was saved.") offers "Go to <that section>". Activating a character outside Create offers "Go to Create".

The **Character section of the generation panel** shows the active character: thumbnail, name, tags (at most 3 lines), seed lock, Deactivate, Edit (opens the editor in Characters; Cancel returns to Create), its reference strength and whether its references apply with the selected model. Without one, it offers the "Active character" dropdown and "New character". It stays readable at the panel's 300 px minimum. One character at most is active; the backend saves which one. The command bar shows the active character too.

How the active character takes part in a generation (the precedence is documented once, at the top of `frontend/src/domain/characters.ts`):

1. Its identity tags are the locked sub-prompt of a pinned **'Character'** category, its outfit tags the locked sub-prompt of a pinned **'Character outfit'** category. The prompt engine selects them before every user category, whatever the priorities; they never use a cycle counter and draw nothing from the prompt seed, so the same prompt seed still picks the same user sub-prompts. They appear in the Used sub-prompts tab and the output metadata like any category (locked), so forbidden rules can be created with them.
2. Forbidden rules: the character wins. A user sub-prompt forbidden together with the identity or the outfit is never chosen (another one of its category is, or the category is skipped), and the board's cards show it as indirectly disabled. The outfit is skipped when a rule forbids it together with the identity.
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

### Story

Story mode is an illustrated storyboard. A **story** has a title, its characters, its flow (a logline, a synopsis, style and tone notes) and an ordered list of **scenes**; a scene has a title, its narrative text, its flow notes (beat, shot, setting, mood), its prompt overrides (per-frame tags, locks, LoRAs, cast, seed) and its pictures (variants), one of which is its picture. The flow notes plan the story; they are never added to a prompt.

The **Story section** (rail item Story, `Ctrl+5`) is a full page:

- **Commands** ("Story commands" toolbar): New story (primary), Add scene, **Generate missing (N)** (the scenes without a picture, one after the other), **Read** (a toggle: the reader) and **Export**. While scenes are generated, the run's progress ("Scene 2 of 5 · The storm" and a bar) and Cancel (amber) replace Generate missing; Cancel stops the scene being generated and drops the others.
- **Stories** (the navigation pane): every story with its cover (the picture of its first illustrated scene), its title and how far it is illustrated ("3 scenes · 2 illustrated"); the selected one is current. The first story is selected at startup.
- **Scenes** (the results): the story's settings (its title, saved when the edit is done; its characters, picked among the Characters section's characters; its **Logline**; **Synopsis and style**, a disclosure with the **Synopsis** and **Style and tone** (saved when you leave the field, `Ctrl+Enter` too; the header says how many of the two are filled); Delete story, red, after a confirmation: its outputs are kept), then the scene cards in reading order and an "Add scene" tile. A card shows its position, title, picture (or "No picture yet"), its status (Illustrated, Not illustrated, Generating with the step progress, Queued), the start of its text, and Generate / Regenerate, Duplicate and Delete (red, after a confirmation; its outputs are kept). **Reorder** like the prompt board's cards (the same reorder kit): drag a card's handle (a brand bar shows where it lands), or focus the handle and use `←` / `↑`, `→` / `↓`, `Home` and `End`; moves are announced ("The storm moved to position 1 of 3") and the focus stays on the handle.
- **Scene details** (the detail panel; `Escape` or Close returns to the card): the picture with its status, **Generate / Regenerate** (primary; Cancel while it runs), "Use the current output" (the output shown in Create becomes a variant and the picture), the **variants** (every picture made for or added to the scene; pick one to make it the picture; **Remove variant** (the small button on each) takes it off the scene, the output is kept, and when it was the picture the latest remaining one becomes the picture; with the last one the focus moves to Generate); the title and the text (saved when you leave the field, `Ctrl+Enter` too, `Escape` puts it back); the **flow**: Beat, Shot, Setting and Mood (saved trimmed when you leave the field); the **prompt**: scene tags, locked sub-prompts (pick any sub-prompt of any category; each one replaces what its category would pick; one per category), **Scene LoRAs** (pick from the library, a weight field per LoRA (the same field as the LoRA selection and the character editor), Remove; only in this scene), negative tags, characters ("Same characters as the story", or the scene's own, none allowed) and a fixed seed (empty: a new seed for every picture; the shuffle button clears it); then Duplicate scene and Delete scene.
- **Read** shows the selected story as a picture book, one scene per page: the picture on the left, the title and text on the right. `←` / `↑` / `Page Up` and `→` / `↓` / `Page Down` / `Space` turn the pages, `Home` / `End` go to the first / last page, `Escape` closes it (the page read last becomes the selected scene); Previous page, Next page and Close reader do the same.
- **Export** saves the story as one self-contained HTML file: every scene's picture embedded (JPEG, at most 1600 px), its title and text, light and dark color schemes, one scene per printed page. In the desktop app a save dialog picks the file; in the browser it is downloaded.
- **Empty states**: no story yet ("Tell a story, picture by picture" with New story), a story without scenes (Add scene, or Go to Create to add an output), no scene selected.
- **Co-writer** (the dock after the scene details, also next to the reader): see Co-writer below. It can be collapsed to a strip (Collapse co-writer in its header, Expand on the strip); the choice is saved (`story-store`).
- At 1280 x 720 the stories pane, the scene cards, the scene details and the co-writer fit side by side (one card column); with the co-writer collapsed, two card columns.

How a scene's picture is made, documented once at the top of `frontend/src/domain/stories.ts` (the generation goes through the same `buildGenerationRequest`, generation store and backend generation service as Create; nothing is built twice):

1. **Characters**: the scene's characters when it names its own, else the story's, else the active character (like Create). They take part like the active character (see Characters); with several, each further one gets 'Character 2' / 'Character outfit 2' categories, their LoRAs and negative tags follow in order, the first locked seed wins, and only the first one's reference images apply.
2. **Pinned categories**, selected before every user category: the characters', then one per locked sub-prompt (named after its category, which it replaces for that picture; its prompt-linked LoRAs come along), then 'Scene' (the scene tags). A lock of a category the characters pin is ignored (shown as replaced).
3. **Negative tags**: the characters', then the scene's, each appended once.
4. **LoRAs**: the characters', then the scene's own LoRAs, then the selected LoRAs with their weights, then the prompt-linked ones. A scene LoRA uses the scene's weight, also when the characters or the selection have it (weight 0 turns a LoRA off for that scene); a character LoRA uses the character's weight over the selected one; a LoRA that is only prompt-linked gets the default weight. Scene LoRAs missing from the library are skipped with a warning.
5. **Seeds**: the scene's fixed seed, else the characters' locked seed, else a new random seed (every Regenerate is a new variant). The prompt seed follows Create's prompt seed field (the per-category cycle draws a random one instead and its counters are left alone). Scene pictures never change Create's seed fields, the output shown in Create or the undo history; they are listed in the filmstrip like every output.
6. The request names the scene (`story`): the backend records `OutputRecord.story` and makes the new output the scene's picture.

Variants (THE rules, `backend/app/services/stories.py`): a picture made for a scene, or an output added to it, becomes a variant and its picture; adding an output that is already a variant only picks it; removing a variant keeps the output, and when it was the picture the latest remaining variant becomes the picture. A scene whose picture was deleted from the outputs counts as not illustrated.

**Add to story** (Create, viewer output actions): the scene reproduces the output: its picture (the first variant), its sub-prompts as locked sub-prompts (except the categories of the scene's characters), its image seed as the fixed seed; its characters are the story's when they are exactly the output's character, else the output's character (or none). "New story" starts a story whose character is the output's.

**The story action API** (`src/stores/storyStore.ts`): every story rule is behind the story store's actions, which the views call and which a tool layer (the co-writer) calls the same way: `load`, `createStory` (title, characters, flow; `select: false` leaves the selection for later), `updateStory` (title, characters, logline, synopsis, style notes), `deleteStory`, `selectStory`; `addScene`, `addScenes` (several, in order, from an index), `updateScene` (title, text, flow notes, extra / negative tags, locks, LoRAs, characters, seed), `updateScenes` (several scenes, saved in order), `lockSubPrompt`, `unlockCategory`, `setSceneLora` / `removeSceneLora`, `duplicateScene`, `deleteScene`, `moveScene` / `moveSceneNextTo` / `setSceneOrder`, `selectScene`; `generateScene`, `generateScenes`, `generateMissing`, `cancelGeneration`, `chooseVariant`, `addVariant`, `removeVariant`, `addSceneFromOutput`, `previewScene` (what generating would send: THE request builder through `generationStore.previewScene`; nothing is sent); `openReader`, `closeReader`, `setReaderPage`, `exportStory`. Every action resolves (failures are notified; it answers null / false / []). Writes of one story are serialized; a scene change shows at once.

**The dock**: a panel plugs into the Story section by its entry in `STORY_DOCK_PANELS` (`src/features/story/storyDock.ts`; registered: the co-writer): it is shown after the scene details (and in the reader) as a complementary landmark named after it, an F6 region, collapsible (the story store's `dockCollapsed`); it reads and changes the stories through the story store's actions only.

Storage: `<data dir>/stories/stories.json` (`{"version": 1, "items": [...]}`, creation order, each story's scenes in reading order). Invalid stories and scenes are skipped; a file that cannot be read, or has another version, is reported (HTTP 503) and never overwritten. The flow fields (`logline`, `synopsis`, `style_notes`; a scene's `beat`, `shot`, `setting`, `mood`) and a scene's `loras` were added without a new version: stories saved before read them as empty, and the next change of a story writes them.

### Co-writer

The co-writer is the user's own Codex, embedded: the backend starts the installed Codex CLI (`codex app-server`) with the user's existing Codex login, and Codex works on the stories through tools the app exposes to it. Nothing needs an API key; nothing reads Codex's configuration files or credentials.

**The panel** (Story section, the dock; `src/features/coWriter/`):

- Header: "Co-writer", the Codex version and model ("Codex 0.169.0 · gpt-5.6-sol"), and the commands: **Model** (a menu: "Default (<the model of the user's Codex configuration>)" and the models the user's Codex offers; the choice is saved in the backend settings), **New conversation** (the story gets an empty conversation; disabled while Codex answers or the conversation is empty) and **Collapse co-writer**.
- The conversation of the selected story (a log): the user's messages, Codex's answers (streamed as they are written, shown as Markdown: headings, paragraphs, lists, bold, italic, inline and block code, quotes, tables and links; parsed by `src/domain/markdown.ts` and rendered as React elements by `src/ui/Markdown.tsx`, so no HTML from the text ever reaches the page, a link keeps only an http(s) or mailto address and opens outside the app), its tool activity ("Created The night ferry with 3 scenes", "Edited 3 scenes of The night ferry (tags, LoRAs)", "Generating Scene 3 · Morning calm…", "Illustrated Scene 3 · Morning calm", "Edited Lina (outfit tags)", with **Show**, which selects that scene or story, or opens that character in the Characters section; a failed one says why), errors (a red message bar) and notices ("Stopped."). The newest entry stays in view unless you scrolled up; screen readers hear each finished answer and tool activity (a polite live region), not every streamed word. An empty conversation says what Codex can do.
- The message box: `Enter` sends (`Shift+Enter`: a new line). While Codex answers, Send becomes **Stop** (amber): it interrupts the answer and abandons its running tool calls; a scene generation a tool started is cancelled. The next message can be typed meanwhile; the draft of each story is kept.
- Setup states, each with **Retry**: looking for Codex; **Codex was not found** (where the app looked, and a "Codex path" field: Use this path / Detect automatically); **Sign in to Codex** (open the OpenAI Codex app, sign in with the ChatGPT account, then Retry; the installed version is shown); **Codex could not start** (its message, the path field); the backend not answering.
- One conversation per story; while no story is selected the user talks in a draft conversation. A story the co-writer creates (create_story) joins the conversation that created it, so the conversation goes on, shown with the new story (a draft conversation becomes that story's). Conversations survive reloads and restarts: Codex keeps the history (its threads); the backend saves which thread each story has (`<data dir>/codex/conversations.json`) and reads the history back from Codex (thread/turns/list) the first time a story's conversation is shown. One answer runs at a time.

**Finding Codex** (`backend/app/services/codex/discovery.py`, in this order): the path set in the panel (a `codex.exe`, or a folder holding it; when it no longer exists, e.g. after a Microsoft Store update changed the versioned folder, the search goes on and says so), `codex` on PATH (an npm shim resolves to its package's native executable), the **OpenAI Codex** desktop app (the newest installed `OpenAI.Codex` package, from PowerShell's `Get-AppxPackage`: `<InstallLocation>/app/resources/codex.exe`; the WindowsApps folder itself cannot be listed), then the npm global install. The status (found where, which version, signed in, the default model, the models) comes from a short-lived probe process: `initialize`, `account/read`, `config/read`, `experimentalFeature/list`, `model/list`. A turn failing with "unauthorized" marks Codex as not signed in.

**What Codex may do** (the security model):

- It runs `codex app-server` (JSON-RPC over stdio, app-server protocol v2) in an empty working directory (`<data dir>/codex/workspace`), with `sandbox_mode = "read-only"`, `approval_policy = "never"`, `web_search = "disabled"`, the user's other MCP servers disabled (`mcp_servers.<name>.enabled = false`) and the feature tools of the installed version that exist and are on disabled (`--disable shell_tool`, `plugins`, `apps`, `view_image`, `image_generation`, ...; the probe says which exist, so an unknown flag never stops Codex). Any command or file change it still asks for is declined; other approval requests are refused. Its developer instructions (`services/codex/instructions.py`) define the co-writer: the recommended workflow and the tag conventions (see below), pictures only when asked, the user's confirmation before deleting a story, scene or character or downloading IP-Adapter files.
- Its only way to act is the app's MCP server (`services/codex/mcp_server.py`): streamable HTTP on **127.0.0.1 only**, on a port of its own (never the backend's host, which may be 0.0.0.0), protected by a random token made per backend process and given to the Codex process only, through an environment variable its config names (`mcp_servers.prompt_weaver.bearer_token_env_var`; never on a command line, never logged). Requests with an Origin header (a web page), another Host or no valid token are refused. Tool calls are approved without prompting (`default_tools_approval_mode = "approve"`) and only reach the app while a co-writer turn runs.
- **One path per action**: a tool call never changes a story in the backend. The backend validates its arguments (the Pydantic models of `schemas.py`) and sends it over `/ws/tasks` to the window that sent the message (each window names itself with a random `client_id`); that window runs it with the stores' actions (`src/stores/coWriterTools.ts`: the same `addScenes`, `updateScenes`, `setSceneOrder`, `generateScenes`, `chooseVariant`, `previewScene`, `createCharacter`, `updateCharacter`, `install` ... as the views), so every rule lives once and the storyboard shows the change because it made it; the result goes back to the backend and to Codex. A result may name pictures (view_images): the backend reads them, downscales them with the one picture rule (`services/pictures.py`, at most 640 px, JPEG; `services/codex/images.py`) and sends them to Codex as MCP image content after their labels. The window that runs a `create_story` shows the new story with its conversation at once (the backend adopts it when the result arrives). When that window is not connected (closed, reloaded), the call fails at once with a message Codex relays ("ask the user to send the request again"). The window going away, Stop, a timeout (60 s, 30 min for generations) or Codex stopping abandon a running call.
- Each user message starts with an `<app-context>` block (the story and scene shown, with their ids and titles), dropped again when the history is read back.

**What the co-writer can do** (the capability matrix: every user-facing capability of the Story and Characters sections, the prompt board, the LoRA library and the generation settings that matters for a story, and the tool that does it; one path per capability: the same store actions as the UI):

| Area | Capability (in the UI) | Tool |
| --- | --- | --- |
| Story | list the stories, which one is shown | `list_stories` |
| Story | read a story: flow, characters, every scene's text, flow notes, per-frame settings and status, in one call | `get_story` |
| Story | New story with its title, characters, logline, synopsis, style notes and its whole outline (scenes from beats) | `create_story` |
| Story | edit the title, the story characters, the logline, synopsis and style notes | `update_story` |
| Story | Delete story (after the user confirmed) | `delete_story` (`user_confirmed`) |
| Scenes | Add scene, at a position, one or many | `add_scenes` |
| Scenes | edit a scene: title, text, beat, shot, setting, mood | `update_scenes` |
| Scenes | reorder (drag, keyboard): a full order or one move | `reorder_scenes` |
| Scenes | Duplicate scene | `duplicate_scene` |
| Scenes | Delete scene (after the user confirmed) | `delete_scenes` (`user_confirmed`) |
| Per frame | scene tags, negative tags (replace, or add / remove across scenes) | `update_scenes` (`extra_tags`, `add_tags`, `remove_tags`, `negative_tags`, ...; `scene_ids: "all"`) |
| Per frame | lock a sub-prompt of a category / unlock it | `update_scenes` (`locks`, `lock`, `unlock`) with `list_categories` for the valid choices |
| Per frame | scene LoRAs with their weights | `update_scenes` (`loras`, `set_loras`, `remove_loras`) with `list_loras` |
| Per frame | fixed seed / random seed | `update_scenes` (`seed`, `"random"`) |
| Per frame | the scene's own characters / the story's | `update_scenes` (`characters`) |
| Per frame | what a scene's picture would be made with (prompt, negative prompt, LoRAs, seed) | `preview_scenes` |
| Pictures | Generate / Regenerate a scene, several, Generate missing | `generate_scenes` (`scene_ids`, or null: the missing ones) |
| Pictures | pick a variant, Use the current output (any output as a variant), remove a variant | `edit_variants` (`choose`, `add`, `remove`) |
| Pictures | look at the scenes' pictures, outputs, reference images | `view_images` (MCP image content) |
| Characters | the gallery and a character's details (every field) | `list_characters` |
| Characters | New character; Create character from an output (prefilled); from a scene's picture | `create_character` (`from_output_id`, `from_scene`) |
| Characters | Edit: name, identity / outfit / negative tags, LoRAs and weights, seed and its lock, reference focus and strength | `update_character` |
| Characters | add reference images (an output, a scene's picture), remove one | `update_character` (`add_reference_output_ids`, `add_reference_scenes`, `remove_reference_image_ids`) |
| Characters | Activate / Deactivate for Create | `update_character` (`active_in_create`) |
| Characters | Delete (after the user confirmed) | `delete_character` (`user_confirmed`) |
| Characters | whether reference images work with the model (IP-Adapter), Download the missing files (after the user agreed) | `get_generation_setup`, `install_ip_adapter` (`user_confirmed`) |
| Consistency | per scene: cast, identity and outfit tags, LoRAs and weights, seed, references, what the picture was made with; the problems and their fixes | `consistency_report` |
| Prompt board | categories, sub-prompts, their states (locked, skipped, never picked), activation texts, prompt-linked LoRAs, forbidden rules | `list_categories` (read only: the board is the user's, a scene locks or tags instead) |
| LoRA library | LoRAs, trigger words, base model, selected weights, who uses them | `list_loras` (read only: downloads stay in Models) |
| Generation settings | model, size, steps, CFG, negative prompt, seed behaviors, selected LoRAs, active character, a generation running | `get_generation_setup` (read only: the user's Create settings; a scene overrides seed, LoRAs, tags and negative tags) |

Left to the user on purpose: the prompt board, the LoRA library and model downloads, the Create settings and the reader and export (they are the user's own tools; the co-writer reads them and works through per-scene overrides).

**The tools** (`services/codex/tools.py`; arguments, with their descriptions, defaults, enums and examples, in `schemas.py` `CODEX_TOOL_ARGUMENTS`; what they answer in `src/domain/coWriterViews.ts`; what they do in `src/stores/coWriterTools.ts`):

| Tool | Does (through the stores' actions) |
| --- | --- |
| `list_stories` | every story: id, title, logline, scenes, illustrated, which one the user views |
| `get_story` | the whole story compactly: flow, characters, every scene (text, beat, shot, setting, mood, tags, negative tags, locks, LoRAs with names and weights, characters and the cast they give, seed, status, picture, variants); empty values left out |
| `list_characters` | every field of every character (LoRAs named, reference images with their ids, seed lock, focus, strength, active in Create) |
| `list_categories` | the prompt board: categories in generation order with their state, activation text, pickable / locked / skipped / never-picked sub-prompts, prompt-linked LoRAs; the forbidden rules in words (at most 30 sub-prompts each unless `query` picks categories) |
| `list_loras` | the library LoRAs: id, name, trigger words, base model, selected weight, the characters and scenes using them |
| `get_generation_setup` | model, size, steps, CFG, negative prompt, seed behavior, selected LoRAs, active character, running generation, reference image support per focus (with the files to install and their sizes) |
| `preview_scenes` | per scene, the request THE request builder makes (nothing generated): prompt, negative prompt, LoRAs with weights and source, image seed (fixed, locked, random) and its source, prompt seed, the categories still picked at random, cast, references, size, warnings |
| `consistency_report` | per scene: cast and its source, each character's tags, LoRAs, seed and references, the LoRAs / seed / references generating it would use, what its picture was made with (output metadata); then the problems (missing characters or LoRAs, appearance repeated in scene tags, locks replaced by a character, references that cannot apply, a picture made with another cast, LoRAs or seed, a character without locked seed or references, a LoRA at different weights) with what to do |
| `view_images` | the pictures of a story's scenes, outputs and characters' reference images, at most 8, each after its label (downscaled JPEG, 640 px) |
| `create_story` | a story with its characters, flow and outline (scenes), shown once its scenes are in; it joins the conversation |
| `update_story` | title, characters, logline, synopsis, style notes |
| `delete_story` | only with `user_confirmed: true` (the outputs stay) |
| `add_scenes` | one or more scenes at a 1-based position (null: at the end) with every field; checked first |
| `update_scenes` | many scenes in one call: each change targets `scene_id` or `scene_ids` (`"all"`); replace fields or edit the current values (tags, negative tags, locks, LoRAs); every change checked first (nothing changes on an error, the answer lists the valid choices); only the changed fields are saved; answers the changed scenes |
| `reorder_scenes` | a full `order`, or one `scene_id` to a `position` |
| `duplicate_scene` | inserts a copy after it |
| `delete_scenes` | only with `user_confirmed: true` (the pictures stay) |
| `generate_scenes` | pictures through the one generate path, in order (null `scene_ids`: the scenes without a picture); refused without a model or while a generation runs; waits for them |
| `edit_variants` | add outputs as variants, remove variants (outputs kept), choose the picture |
| `create_character` | from scratch, or prefilled from an output or a scene's picture like Create character (its tags, LoRAs, seed; the picture as first reference image), with any field given |
| `update_character` | any field, reference images added (outputs, scene pictures; at most 4) or removed, active in Create |
| `delete_character` | only with `user_confirmed: true` |
| `install_ip_adapter` | only with `user_confirmed: true`: starts the downloads of the IP-Adapter files the model needs for a focus (through the IP-Adapter store's install and the download manager) and answers once they run |

Every tool answers compact JSON for Codex, a summary for the conversation, and the story, scene or character it acted on (the link of its activity row). Unknown ids, categories, sub-prompts, LoRAs (by id or name) or characters are refused with the valid choices; batch tools check every part before anything changes.

**How Codex is asked to work** (its developer instructions, `services/codex/instructions.py`): cast and characters first (identity tags = appearance only, the outfit apart, a locked seed, character LoRAs with their trigger words, reference images from a good picture), then the outline and flow (`create_story` with every beat), then the per-frame tags in one `update_scenes` call, then `preview_scenes`, then pictures only when the user asks (`generate_scenes`), then `view_images` and `consistency_report`, then fixes and the best variant. Tags are Danbooru-style, in the vocabulary of the user's categories (lock a sub-prompt when one fits); a character's appearance lives on the character, a scene's tags hold the action, expression, pose, setting, time, composition and light; the flow notes are turned into tags, never sent as they are. Destructive tools and downloads need the user's confirmation in the conversation.

### Prompt board

The Create section's **Prompt board** region holds the prompt categories as cards in a responsive grid (columns of at least 280 px, cards top-aligned, no free positions). It stays usable with 40+ categories.

- **Toolbar**: the search box ("Search categories"; `Ctrl+F` focuses it, `Escape` clears it) matches names, activation texts and sub-prompt texts; the state filter ("Filter by state"): Any state, Used by the current output, With a locked sub-prompt, Forbidden with the association source, Association source, Indirectly disabled, Skipped. A count shows "N categories", or "M of N categories" with Clear filter while filtered. The "Board commands" toolbar has Add category, Collapse all, Expand all and Sort by priority (`Ctrl+O`).
- **Cards**: a card's header has a drag handle ("Reorder <name>"), the expand toggle ("Collapse <name>" / "Expand <name>"), the editable name, the sub-prompt count and the state icon; a second header row has Priority, Edit all sub-prompts, Add sub-prompt, Skip category and Delete category. The body holds the activation text and the sub-prompts, which scroll inside the card (cards are at most 400 px tall). On a card you can:
  - rename the category
  - set its priority
  - set an optional activation text
  - skip the whole category
  - add, edit inline, skip or delete sub-prompts
  - bulk-edit all of its sub-prompts as text (entries separated by a line containing only `|`; `Ctrl+Enter` applies, `Escape` cancels)
  - lock one sub-prompt so it is always chosen until you unlock it
  - delete the category (after a confirmation)
- **Collapse** a card to its header, or use Collapse all / Expand all; this is saved.
- **Reorder**: drag a card's handle (a brand-colored bar shows where it lands; the board scrolls near its edges), or focus the handle and use `←` / `↑`, `→` / `↓`, `Home` and `End`. Moves are announced ("Subject moved to position 3 of 7") and the focus stays on the handle; the output arrows never fire from it. While a filter is active, cards move relative to the shown cards. The order is display order only and is saved.
- **Sort by priority** (`Ctrl+O`) sorts by priority, then name, renumbers the priorities 1..n and makes that the board order.
- **Add category**: the new card scrolls into view inside the board (never the page) with its name editor open and the name selected, so typing names it. A filter that would hide it is cleared. A card revealed from another section (an image's tags added to a category) is shown when Create is shown.
- Inline edits: `Enter` commits, `Shift+Enter` inserts a line break, `Escape` cancels, and leaving the field commits.
- The sub-prompts used by the output being viewed are highlighted in their cards, which scroll to them.
- A category with an activation text (comma-separated terms) is disabled by default. It only takes part when a sub-prompt selected before it (in generation order) contains one of the terms, ignoring case and extra whitespace.
- Forbidden associations take precedence over activation: a triggered category that would conflict is skipped.
- Categories and sub-prompts that cannot be selected (because of skips, locks, activation texts and forbidden associations) are shown as indirectly disabled automatically. The old `Ctrl+D` "compute indirectly disabled" command no longer exists.

State colors (Fluent 2 tokens, light and dark themes; one table, `frontend/src/ui/stateColors.ts`):

| State | Color | Also shown by |
| --- | --- | --- |
| Forbidden together with the association source | red | prohibited icon |
| Forbidden, and a locked prompt is involved (the active character's prompts count as locked) | purple | shield icon |
| Association source (picked in the Used sub-prompts tab) | green | link icon |
| Used by the output being viewed | brand blue | check icon, `aria-current` |
| Locked sub-prompt | purple accent (the checked Lock toggle) | lock icon |
| Indirectly disabled (can never be selected) | amber, dashed border | icon, italic text |
| Skipped | muted | struck-through text, the checked (amber) Skip toggle |

- Sub-prompt rows show their state with the tinted surface, the border and the icon. When several apply, the strongest wins, in the order of the table.
- Category cards show the state of the whole category on their frame (border), a tinted header and a state icon in the header (its label in a tooltip and the card's accessible description): forbidden, forbidden by a lock, association source, indirectly disabled, skipped (strongest first). A P pick marks the picked sub-prompt and its card, a C pick the whole card and its rows, a tag pick the rows of that category carrying the tag, and the card.
- Action colors: Delete and Remove buttons are red (danger); an active Skip toggle and actions that change what generation uses without deleting anything (Cancel, Clear) are amber (warning); Generate and Save are the brand primary. A disabled button keeps the Fluent disabled look.
- Color is never the only cue: every state also has an icon, a border style or text style, and an accessible description. Text contrast is at least 4.5:1, state borders and icons at least 3:1, in both themes (checked in the real browser by the e2e suite).

### Forbidden associations

- You edit associations in the **Used sub-prompts** tab of the viewer's details panel, which lists the sub-prompts used by the current output (each with a button copying its text). Click two endpoints to toggle an association between them. An endpoint is one of:
  - `P`: that exact sub-prompt
  - `C`: its whole category
  - a tag chip: any sub-prompt carrying that tag
- Rules from older versions, including "contains text" rules, still load.
- Exact sub-prompt matching ignores casing, whitespace and the order of comma-separated tags.
- Category cards and their rows highlight what is forbidden together with the selected association source in red, or purple when a lock is involved (the active character's 'Character' and 'Character outfit' prompts count as locked); the source itself is green (see the state colors above). The P, C and tag buttons of the Used sub-prompts tab show the same states, and the Locked badge is purple.

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
- The Create section's **Current image** region (the viewer) shows, top to bottom: the output actions toolbar, the current picture, the filmstrip and the details panel. It works at its 320 px minimum width.
- **Output actions** ("Output actions" toolbar): "#<id>" and "n / N", then icon buttons with tooltips: First / Previous / Next / Last output (their arrow keys in the tooltips), Copy prompt (the full prompt), Create character (prefilled from the output; see Characters), Add to story (a menu: New story and every story; see Story), Undo (`Ctrl+Z`; disabled when there is nothing to undo), Delete (the red danger action; "Move to the app trash (Undo restores it)") and the "Output details" toggle. In a narrow viewer the toolbar wraps to a second row; arrow keys move between its buttons.
- The **picture** fits the remaining space without distortion, centered on a darker canvas; it is the only picture named "Output <id>". The viewer says when there are no outputs yet ("No outputs yet": press Generate, `Ctrl+G`), when no output is selected, and when the picture of an output cannot be loaded (moved or deleted outside the app). At startup, an output whose picture is missing is not listed.
- The **filmstrip** ("Outputs") is a horizontal list of thumbnails, oldest on the left, loaded lazily from `GET /api/outputs/{id}/thumbnail` (WebP, at most 256 px, cached in `<data dir>/cache/output_thumbnails`). It renders a window of 31 outputs around the current one (`FILMSTRIP_RADIUS`, `src/domain/outputs.ts`), so thousands of outputs stay fast. Click a thumbnail to show its output; inside the list, `←` / `↑` and `→` / `↓` show the previous / next output and `Home` / `End` the first / last, the focus following. The current thumbnail has the "current" frame and is scrolled into view. "Jump to latest" appears while an older output is shown; a thumbnail whose file is missing shows an icon.
- The **details panel** (about 38% of the viewer's height, opened and closed with "Output details") has two tabs, both remembered in `layout-store`:
  - **Details**: output number and position, image name, size, steps, CFG, seed, prompt seed, model, LoRAs with their weights (`name (weight)`, one per line; a long name is truncated with its full name in a tooltip, the weight always stays visible), the character when one was active, the prompt and the negative prompt;
  - **Used sub-prompts**: each category with its chosen sub-prompt, with the P / C / tag association buttons (see Forbidden associations) and Copy sub-prompt.
- The arrow keys move through the output history while Create is shown: left/up goes to the previous output, right/down to the next. They are left to the focused control when it uses them itself (text fields, splitters, the rail, toolbars, reorder handles, menus, dropdowns); click elsewhere to browse again.
- The metadata JSON lists the LoRAs used as `active_loras: [{"id", "weight"}]`. Files written before LoRA weights existed (`active_lora_ids`) still load, with weight 1; they are not rewritten.
- An output made with an active character has a `character` key: `{"id", "name", "reference": {"applied", "variant_id", "strength", "image_ids", "reason"}}`, where `reason` says why the reference images were not applied. Outputs made without a character have no such key (the API answers `character: null`), so older outputs load unchanged. The Details tab shows it as a 'Character' row.
- An output made for a story scene has a `story` key: `{"story_id", "scene_id", "story_title", "scene_title"}` (the titles when it was made). Other outputs have no such key (the API answers `story: null`). The Details tab shows it as a 'Story' row ("The lighthouse · The storm").
- Output ids come from file names only, so the list stays fast with thousands of outputs. Metadata, images and thumbnails are loaded by id through the backend API.

### Delete and undo

- Delete moves the image and its JSON into the app-managed trash folder, `<data dir>/trash`.
- `Ctrl+Z` (or Undo in the viewer's output actions) undoes, newest first:
  - a generation step: it goes back to the previous output and restores the seed inputs (the generated files stay on disk)
  - a deletion: it restores the files from the trash
- `Ctrl+Z` needs exactly that combination: `Ctrl+Shift+Z` does nothing. It is ignored while typing in a text field.

### Generation and progress

- The Create section's **Generation** region is a scrolling panel above a sticky action area. The body, in order: Model (the Checkpoint picker and Browse models; without a model, "No model yet" with Add model file and Browse models), Character (see Characters), LoRAs with their weights and Clear, Image settings (width, height, steps, CFG), Seeds, Negative prompt, then "More options" (collapsed by default: model and LoRA files and folders, the prompt-linked LoRA details).
- The **sticky action area** stays visible whatever the scroll, at 1280 x 720 too: Generate (primary, `Ctrl+G`), Continuous (toggle, `Ctrl+T`, blue while it runs), Cancel (amber) and the one progress bar with its message and step count ("Ready to generate", or "Pick a checkpoint to generate" without a model). In a narrow panel Generate wraps onto its own row. A collapsed generation panel keeps the same three actions, icon-only, in its strip, with a small progress bar.
- `Ctrl+G` and `Ctrl+T` also work while typing in a text field.
- A failed generation shows an error notification and stops continuous generation. LoRAs requested by the selection but missing from the library are skipped with a warning.
- The backend streams progress over the WebSocket `/ws/tasks`. The stages are loading the model, sampling (one update per diffusion step), saving, complete, error and cancelled. `GET /api/tasks` returns the latest event of every task. The progress bar's color and text name the state: blue while running (indeterminate while the model loads), green when complete, orange when cancelled, red with the error message on failure.
- When a generation is cancelled while the backend is already saving it, its output is still listed once the backend completes it.
- The data directory is shown by About at the bottom of the navigation rail.
- In the backend console, the first `Ctrl+C` cancels the running generation and then stops the server gracefully. A second `Ctrl+C` exits immediately.

### Keyboard shortcuts

All bindings are defined once, in `frontend/src/app/keymap.json`. The Electron "Shortcuts" menu is built from the entries flagged `menu: true`; `frontend/src/app/commands.ts` dispatches both the keys and the menu commands. Repeated presses all run (`Ctrl+H` twice cycles twice, a held arrow key keeps navigating); only the Electron menu's echo of the same key press (within 200 ms) is ignored.

| Shortcut | Command |
| --- | --- |
| `Ctrl+1` .. `Ctrl+5` | Show Create, Models, Images, Characters, Story (the focus moves to the section's first region) |
| `F6` / `Shift+F6` | Next / previous region (works from any control) |
| `Ctrl+F` | Search in the shown section (in Create, the board's search) |
| `Ctrl+G` | Generate |
| `Ctrl+T` | Toggle continuous generation |
| `Ctrl+H` | Cycle the Create layout (everything / the board alone / image + generation panel); shows Create first |
| `Ctrl+O` | Sort categories by priority |
| `Ctrl+Z` | Undo |
| `←` / `↑`, `→` / `↓` | Previous / next output (in Create, when the focused control does not use them); previous / next page in the Story reader |

## Architecture

### Project layout

```text
prompt-weaver-local/
  config/
    defaults.json          dev host + ports (single source: launcher, backend, Vite, Electron)
    appConfig.cjs          backend URL and Vite overrides for Node consumers (PROMPT_WEAVER_BACKEND_URL,
                           PROMPT_WEAVER_VITE_CACHE_DIR, PROMPT_WEAVER_VITE_HMR)
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
        models, model_installs, downloads, images, characters, ip_adapters, stories,
        codex, provider_errors (provider error -> HTTP status)
      services/            domain logic and IO, constructed with injected paths
        container.py       build_services -> AppServices
        json_files.py      crash-resilient JSON files (.new/.old sidecars, one lock per file)
        http.py            the only place that builds outgoing httpx clients (HttpClientFactory), describe_http_error
        files.py           small filesystem helpers (remove_quietly)
        backend_settings.py  backend_settings.json: provider API tokens (never leave the backend), the co-writer's
                           Codex path and model
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
        stories.py         StoryStore: stories.json, scenes, scene order, the variant rules, the scene link of generations
        codex/             the co-writer: service.py (CodexService: the Codex process, status, turns, events), discovery.py
                           (finding Codex), rpc.py (JSON-RPC over stdio), mcp_server.py (the app's tools over MCP on
                           127.0.0.1), broker.py (tool calls -> the window -> the result), tools.py (the tool catalog),
                           protocol.py (Codex items -> entries), conversations.py (per story, conversations.json),
                           instructions.py (developer instructions: workflow, tag conventions; the app context),
                           images.py (the pictures a tool shows Codex, downscaled)
        story_export.py    a story as one self-contained HTML picture book
        ids.py             record ids ("chr-", "img-", "sty-", "scn-" + 12 hex) and UTC timestamps
        model_installs.py  install = find on disk or download; ModelSource provenance; display names
        legacy_state.py    app_state.json / library.json (read-only seeds)
        outputs.py         output ids, metadata, images, thumbnails (cache/output_thumbnails), trash/restore
        pictures.py        the one picture downscaling rule (fit_within) and atomic picture writes (characters, outputs)
        persisted_stores.py  frontend store files, legacy Electron formats included
        task_hub.py        latest event per task + WebSocket fan-out
        generation.py      generation orchestration, GeneratorPort, character references (ReferenceInput)
        runtime_adapter.py the only importer of the diffusion_lora_runtime generator (loaded lazily)
        signals.py         Ctrl+C cancels, second Ctrl+C exits
    openapi.json           committed OpenAPI snapshot
    tests/                 pytest + TestClient on temp dirs with a fake generator and a fake network
                           (support.py: FakeHttp, StubProvider, StubImageProvider, CatalogStub, FakeDownloadManager,
                           the tiny IP-Adapter catalog; fixtures/civitai, fixtures/huggingface: real answers;
                           fixtures/characters: a version 1 characters file; fake_codex.py: a scripted Codex app-server,
                           codex_support.py: it as the user's Codex)
      e2e/                 the e2e backend (server.py, reset options.py, seed.py, fake_civitai.py, images.py) and its
                           synthetic fixtures (data dir template, model files, Civitai catalog); never imported by the app
    scripts/bench_generation.py  generation benchmark on the real GPU (see "Generation benchmark"); not a test
    run_backend.py
  frontend/
    electron/              main.cjs (backend start, window, dialogs), preload.cjs (bridge), ipcChannels.cjs,
                           shortcutMenu.cjs (menu from keymap.json), windowTheme.cjs (Fluent background),
                           externalLinks.cjs (web links open in the system browser), saveTextFile.cjs (save
                           dialog + write of an exported story) + tests
    scripts/               apiTypes.mjs + generate-api-types.mjs (npm run gen:api)
    e2e/                   Playwright suite (real Edge, dark + light): support/ (env, fixtures, app driver, backend
                           client and persisted stores, network, diagnostics, visibility and geometry checks, the docked
                           shell geometry, colors and contrast, screenshots, baselines, shared flows), smoke.spec.ts, one
                           folder per area (shell, categories, generation, outputs, library, models, images, characters, story)
                           with its specs and area helpers, journeys/ (task flows across sections), electron/ (Electron
                           smoke test), __screenshots__/ (committed baselines)
    src/
      api/                 schema.gen.ts + defaults.gen.ts (generated), types.ts, config.ts (URLs), client.ts,
                           taskSocket.ts, clientId.ts (this window's id)
      persistence/         persist.ts (the one persistence mechanism), storeBackend.ts, storeNames.ts
      domain/              pure logic: text, guards, categories, forbiddenRules, reachability, promptEngine,
                           seeds, library, loraSelection, generationRequest, outputs (filmstrip window), board (card
                           order, filters, moves, legacy order), layout (Create regions: fit, limits, collapse, Ctrl+H
                           cycle, legacy widths), legacyLayout (the floating-window stores, read only), legacyImport,
                           paths, modelCatalog, imageLibrary, characters (prompt injection, casts), characterDrafts (editor form),
                           stories (scene prompt overrides, missing scenes, Add to story prefill, locks, moves, reader),
                           coWriter (conversations, tool activity and its links), coWriterViews (what the tools answer
                           Codex: stories, characters, board, LoRAs, setup, previews, the consistency report; resolving
                           what Codex names), markdown (the safe Markdown subset of Codex's answers)
      stores/              one zustand store per domain (see "Frontend stores" below), pagedSearch.ts (the search
                           engine of the online catalogs), clipboardActions.ts, flags.ts (busy flag records)
      features/            thin Fluent views per feature: categories (the prompt board), forbidden (Used sub-prompts),
                           outputs (the viewer: toolbar, picture, filmstrip, details tabs), generation (generation panel,
                           actions, command bar), library, models, images, characters, story (the section pages; the dock registry),
                           coWriter (the co-writer panel)
      shell/               AppShell (rail + one lazily mounted <main> per section, F6 / Ctrl+F focus), NavRail
                           (Downloads indicator, About), CreateSection (command bar, Layout toolbar, regions, splitters,
                           collapsed strips), sectionViews.tsx (which view and icon each section has)
      ui/                  shared views and hooks: SectionLayout (full-page sections), DetailPanel + SectionToolbar,
                           EmptyState, FactList, Markdown (safe rendering), Splitter, boot screen and error card, error boundary, notifications host,
                           PaneLayout, keyboard hints, visuallyHidden, useInfiniteScroll + LoadMoreButton, spinButtonValue,
                           ConfirmDialog, stateColors.ts (semantic state and action colors) + stateStyles.tsx (their
                           classes and icons)
      app/                 App, providers + theme, sections.ts (section and region names), keymap.json, commands.ts,
                           global shortcuts
      services/            desktop bridge (Electron preload) and clipboard
      test/                Vitest setup, render (through the real AppProviders) and dialog helpers, state class
                           assertions (stateClasses.tsx), IntersectionObserver stub, model, image library and character
                           test data, character store doubles for view tests
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
- **Sections, regions and layout.** The section ids, names, descriptions and shortcuts, the Create region names and the shell landmark names belong to `src/app/sections.ts` (the views, the stores and the e2e suite use them). The Create layout rules (defaults, minimum and maximum widths, fitting the regions into the window, collapsing, the `Ctrl+H` cycle, the widths derived from the legacy layout) belong to `src/domain/layout.ts`; the board order, filters and moves (and the order derived from the legacy window positions) to `src/domain/board.ts`; the shapes of the floating-window stores of older versions to `src/domain/legacyLayout.ts`. Category priority defaults belong to the categories domain. The legacy `app_state.json` fields are nullable on the backend and carry no defaults.
- **Model folders and data dir layout.** `backend/app/settings.py` (`DEFAULT_MODELS_ROOT`, `MODEL_KIND_SUBDIRS`, `AppPaths`); the UI shows the folders reported by `GET /api/models/info`.
- **Model library rules** are backend-owned and only read by the frontend: which file of a version gets installed (`RemoteModelVersion.default_file_id`), whether it can be installed (`unavailable_reason`), the display name of an install (`InstalledModel.name`, the download task title), the base model -> architecture mapping and the NSFW level rule (`model_providers/civitai.py`), and file hash normalization (`services/file_hashes.py`: `normalize_sha256` for SHA-256, `normalize_file_hash` for the short Civitai hashes too).
- **Downloads.** Every model file, including the LoRAs and checkpoints of "Use these LoRAs" / "Use this checkpoint", is installed through one flow: `modelCatalogStore.install` -> `POST /api/models/install` -> `DownloadManager`. IP-Adapter files go through the same `DownloadManager` (`ipAdapterStore.install` -> `POST /api/ip-adapters/{variant_id}/install`). "Already on disk" (by name and size, or by hash) has one owner, `services/local_models.py` `LocalModelFiles`, used per model kind and per IP-Adapter folder; in the UI, the label, color and icon of each file status ('On disk', 'Downloading', ...) have one owner, `features/models/VersionStatusBadge.tsx`.
- **Characters.** The data shape is `schemas.py` (`Character`, `CharacterDraft`, image sources, `OutputCharacter`); storage, ids, image imports and the active character belong to `services/characters.py` (`CharacterStore`); the frontend mirrors them in one store, `charactersStore`. Their injection into prompt building and its precedence belong to `src/domain/characters.ts`; the editor form, its validation and the prefills from an output or an image to `src/domain/characterDrafts.ts`. An image's LoRAs as library entries with weights are collected once, by `imageLibraryStore.collectImageLoras`, for both "Use these LoRAs" and "Create character".
- **Stories.** The data shape is `schemas.py` (`Story`, `Scene`, `SceneLock`, `SceneVariant`, the create / patch requests, `StoryLink` and `OutputStory`); storage, ids, the scene order and the variant rules belong to `services/stories.py` (`StoryStore`), the HTML export to `services/story_export.py`; the frontend mirrors them in one store, `storyStore`, which owns every story action. How a scene's picture is built (its prompt overrides as pinned categories, its characters, its seeds) belongs to `src/domain/stories.ts`, on top of the one prompt builder (`buildGenerationRequest`) and the one generate path (`generationStore`, `POST /api/generate`).
- **Co-writer.** The shapes (status, settings, the tool names and their arguments with descriptions, defaults, enums and examples, the tool calls and results with their pictures, conversations, entries, the `CodexEvent` WebSocket messages) are `schemas.py`; the Codex process, its protocol, discovery, the conversations, the tool routing and reading the pictures belong to `services/codex/` (`CodexService`); what the tools say to Codex to `services/codex/tools.py`; what each tool does to `src/stores/coWriterTools.ts`, on top of the stores' actions (story, characters, IP-Adapter, outputs; no story or character rule twice); what each tool answers to `src/domain/coWriterViews.ts` (previews and the consistency report read the request of THE request builder, never a second prompt computation); the frontend mirrors the status and the conversations in one store, `codexStore`.
- **IP-Adapters.** The catalog (Hugging Face repo, pinned revision, file names, sizes, SHA-256, variants per family and focus) and the rule "can reference images apply with this model and focus, and why not" belong to `services/ip_adapters.py`; both the UI (`GET /api/ip-adapters`) and generation use that one rule, and `ipAdapterStore` never computes support itself. Which pipeline family the runtime loads a model as belongs to `diffusion_lora_runtime.pipeline_architecture` (torch-free; the runtime's own loader uses it too). The runtime request is `IPAdapterSpec`, built only in `services/runtime_adapter.py`.
- **Host and ports.** `config/defaults.json` is read by the launcher, `backend/run_backend.py` and `config/appConfig.cjs` (Vite and Electron). The frontend builds every backend URL in `src/api/config.ts`.
- **Frontend state.** Each domain has exactly one zustand store that owns its state and actions (see below).
- **Accessible names shared with tests.** Labels that views render and tests look up live in small pure modules next to their views: `src/features/outputs/viewerLabels.ts`, `src/features/generation/generationLabels.ts`, `src/features/images/imageLabels.ts` (and `src/app/sections.ts` for the shell).
- **Shared views.** One empty state (`src/ui/EmptyState.tsx`), one fact list (`src/ui/FactList.tsx`), one detail panel frame with its focus rules (`src/ui/DetailPanel.tsx`), one splitter (`src/ui/Splitter.tsx`), one full-page section layout (`src/ui/SectionLayout.tsx`).
- **Semantic state colors.** `src/ui/stateColors.ts` is the one mapping of every semantic visual state (forbidden, forbidden by a locked prompt, association source, used by the current output, locked, indirectly disabled, skipped; `VISUAL_STATES` is also their precedence) and every action intent (primary, danger, warning) to Fluent 2 tokens; `src/ui/stateStyles.tsx` builds the classes and icons views use from it (action classes color enabled buttons only), and the e2e suite reads it to check the colors the browser computes. Which state a row, a category card or a Used sub-prompts endpoint is in is decided once, by `forbiddenRulesStore` (`useSubPromptVisualState`, `selectCategoryCardStates` / `useCategoryCardState`, `buildUsedSelectionRows`) on top of `src/domain/forbiddenRules.ts`. Views never pick state tokens themselves (the remaining palette/status tokens are the file status badges of `VersionStatusBadge.tsx`, which use Fluent badge colors, and the error icon of the boot error card).
- **End-to-end tests.** Ports, URLs and shared Playwright settings: `e2e/support/env.ts`; the test object and its fixtures: `e2e/support/fixtures.ts`; the reset options: `backend/tests/e2e/options.py` (the TypeScript side only passes them through); page helpers (open, settle, the rail, sections, Create regions, command bar, category cards, generation actions, viewer tabs, toasts, pointer parking): `e2e/support/app.ts`; the docked shell geometry and the Create layout files: `e2e/support/shell.ts`; flows several areas need (generate one output, Go to Create from a toast): `e2e/support/flows.ts`; persisted store reads, saves and fixture store files: `e2e/support/backend.ts`; colors and WCAG contrast: `e2e/support/colors.ts`; visibility and geometry checks: `e2e/support/visibility.ts`. Area helpers live in their area folder and build on these.
- **Untrusted values.** Persisted and imported data is validated through `src/domain/guards.ts`; lists of backend enum values (seed behaviors, torch dtypes) are exhaustive typed records, so the type-check fails when the schema changes.

### Frontend stores

The frontend is organized around zustand stores, one per domain. Each store is the single holder of its domain's state and owns its actions: API calls, WebSocket handling, persistence and cross-store coordination (`useOtherStore.getState().action()`) happen in store actions, never in components. Pure algorithms live in `src/domain` and are unit-tested; derived data is computed by selectors and memoized hooks, never stored twice. Components are thin views: they subscribe with fine-grained selectors, call actions, and keep only ephemeral UI state (an edit draft, an open dialog, the rect during a drag). Store logic is tested without rendering.

| Store | Owns | Persisted as |
| --- | --- | --- |
| `categoriesStore` | categories and sub-prompts (`addSubPromptWithText` for tags from the Images section; `addCategory` reveals the new card with its name editor open); keeps the board in step (reveal on add, forget on delete, rename, the order after Sort by priority: `reorganize`); reachability ("indirectly disabled") hooks, which include the active character's pinned categories | `categorie-store` |
| `forbiddenRulesStore` | forbidden rules, the association source of the Used sub-prompts tab, highlights (the active character's prompts count as locked), and the semantic visual state of every row, category card and Used sub-prompts endpoint (`useSubPromptVisualState`, `selectCategoryCardStates` (every card in one memoized pass) / `useCategoryCardState`, `useIsSubPromptDesignated`, `useIsCategoryDesignated`, `useCategoryForbiddenHighlight`, `buildUsedSelectionRows`) | `forbidden-associations-store` |
| `libraryStore` | models, LoRAs (with model library provenance), the model selection and the LoRA selection with weights (`selectedLoras`, `useSelectedLoraRows`, `selectSelectedLoraCount`), display names (`selectModelName`, `selectLoraName`), file dialogs, registration of installed models | `library-store` (version 2) |
| `modelCatalogStore` | Models section: the view (Online / Local library), the model shown in the detail panel (`selectedModelKey`, `selectModel` / `closeModel`), provider info, search filters, results and paging, picked versions, installs in progress (a completed install marks its file local in the results), provider token updates, the local library's `applyLibraryCheckpoint`. `install(model, version, fileId, {select, announce})` resolves to an `InstallOutcome` (installed + library entry, failed, cancelled, refused); a second install of a running install joins it; an install that selects announces it with "Go to Create" | - |
| `imageLibraryStore` | Images section: the view (Search / Favorites), the image in the detail panel (`selectedImageKey`, `openImage` / `closeImage`), search filters, results and paging, the resolution of each image's models, running "Use these LoRAs" and checkpoint switches (announced with "Go to Create"), Add to category (reveals the card on the board), favorites (read from and saved to the backend); `collectImageLoras` (an image's LoRAs as library entries with weights, shared with "Create character") | - |
| `charactersStore` | the frontend copy of the backend-owned characters (`/api/characters`) and the active character (`activeId`), the character editor (form, and the images a new character will import), busy flags, the gallery's search (`query`, `setQuery`, `useGalleryCharacters`) and selected character (`selectedId`, `select`), the section the editor was opened from (`returnSection`: Cancel goes back there); actions: load, setActive / toggleActive, startCreate / startCreateFromOutput / startCreateFromImage / startEdit (they show the Characters section), form and form-LoRA edits, saveEditor, remove, reference images (current output, file, remove, thumbnail), setReferenceStrength; the values API of the co-writer (createCharacter with its reference images, updateCharacter of any field, addReferenceImage), each answering the saved character | - (the backend saves characters and `active_id`) |
| `ipAdapterStore` | the IP-Adapter status read for the selected model (variants, files on disk or downloading, reference support per focus), running installs and the failed downloads of each installed variant (`installFailures`, `selectFileFailure`, `selectVariantFailure`); actions: refresh (views call it when they show reference support and when the selected model changes), install (follows the downloads through the tasks store), cancelInstall | - |
| `generationSettingsStore` | size, steps, CFG, negative prompt, seed inputs and behaviors | `settings-store` |
| `generationStore` | single and continuous generations (with the active character), the generations of story scenes (`generateScene`: the same request building with the scene's input; the output is listed, the seeds, the viewer and undo are left alone), `previewScene` (that request, built and not sent), cancel; lists the output of a cancelled generation the backend still completed | - |
| `outputsStore` | output ids, current output and its metadata, the filmstrip window (`selectFilmstripIds`, `selectLatestOutputId`), which outputs exist (`selectOutputIdSet`), outputs listed without being shown (`addGenerated`), any output's metadata without showing it (`readRecord`), delete/restore, copy | `current-image-store` |
| `storyStore` | the frontend copy of the backend-owned stories (`/api/stories`), the selected story and scene, the reader (read mode and page), a running "generate scenes" run (current scene, queue, progress), exports in progress, the dock's collapse (`dockCollapsed`, `setDockCollapsed`); THE story action API (see Story); `useMissingSceneIds`, `useSceneStatus`, `useCanGenerateScenes` | `story-store` (version 0: `dockCollapsed`; the backend saves the stories) |
| `codexStore` | the co-writer: the status of the user's Codex (`loadStatus`, Retry, `setCodexPath`, `setModel`), the conversations of the stories and the draft one (`openConversation`, `send`, `stop`, `newConversation`, `selectConversation`), the composer drafts, the events of `/ws/tasks` (`applyEvent`: snapshots and events ordered by the conversation's `revision`), the tool calls this window runs (`runCall` -> `coWriterTools.ts`; Stop cancels a generation they started; a story a call created shows with its conversation at once) | - (the backend saves the settings and the conversations index) |
| `undoStore` | undo stack (generation steps, deletions) | - |
| `tasksStore` | the `/ws/tasks` socket (it names this window, `CLIENT_ID`, and hands the co-writer's events to `connect({ onCodexEvent })`), latest task event per task, generation progress (stage, outcome: idle / running / complete / error / cancelled, bar fill), download progress, the running downloads of any source (`selectActiveDownloads`, `useActiveDownloadCount`, `selectActiveDownloadRatio`: the Models badge and the Downloads indicator), `waitForTask` | - |
| `navigationStore` | the shown section and the sections visited (mounted) so far, focus requests (F6 / Shift+F6 region cycling, `Ctrl+F` search, the first region after `Ctrl+1..5`), `goToSectionAction` (the "Go to <section>" action of hand-off toasts, not offered while that section is shown: `useApplicableAction`) | - |
| `layoutStore` | the docked Create layout: image and generation widths, collapsed regions (never all), the output details panel (open, tab), the `Ctrl+H` cycle | `layout-store` (version 0) |
| `boardStore` | the prompt board: card order, collapsed cards, search and state filter (`useVisibleCategoryKeys`, with the card states of `forbiddenRulesStore`), moves (`moveCategoryNextTo`, `moveCategory`), reveal requests (`revealCategory`: expands the card and the board, clears a filter that hides it) | `board-store` (version 0: order, collapsed) |
| `notificationsStore` | user-facing errors, warnings and confirmations, each with an optional one-click action (`notify({ action })`, `runAction`) | - |
| `sessionStore` | boot: bootstrap, hydration of every persisted store, legacy seeding (including the layout and the board from `app_state.json` when no layout was ever saved), resuming running installs, loading the characters and the stories in the background (never delays or fails boot; a failure shows in the Characters or Story section with Retry) | - |

Copying text with a notification goes through one action module, `src/stores/clipboardActions.ts` (`copyTextWithFeedback`), used by the outputs, model catalog and image library stores. Busy / running flag records (`Record<id, true>`) are updated with `withFlag` (`src/stores/flags.ts`). The two online catalogs share one search engine, `src/stores/pagedSearch.ts` (debounced query, abort of the previous request, stale answers ignored, pages appended without duplicates).

Persisted stores are declared with `persistedStoreOptions` (`src/persistence/persist.ts`) and their names come from `src/persistence/storeNames.ts`; a shape change bumps the store version and adds a `migrate` with a test.

### Persistence

- The backend persists the frontend stores at `<data dir>/stores/<name>/state.json`, through `GET/PUT/DELETE /api/stores/{name}`. Reads and writes of one file are serialized (`json_files.path_lock`), so a read racing a write of the same store never breaks the write (on Windows a replace onto a file open for reading fails); a sharing violation from another process is retried for about a second. Each file holds the zustand envelope `{"state": ..., "version": n}`. The formats written by the former Electron storage still load: JSON `null`, a legacy string map, and legacy flat `<name>.json` files. A file that exists but cannot be read is reported as an error rather than treated as empty, so it is never overwritten.
- `src/persistence/persist.ts` is the only persistence mechanism. It hydrates stores explicitly at boot, ignores writes until a store has been read, coalesces writes, and runs legacy merge migrations.
- On first start, stores without persisted data are seeded from the legacy `app_state.json` and `library.json`, which `GET /api/bootstrap` returns (LoRA references missing from the library are stripped). The app no longer saves its state to these two files: `library.json` is a read-only seed, and the library lives in `library-store`.
- `layout-store` (version 0) holds the Create layout and `board-store` (version 0) the board (card order, collapsed cards). When they do not exist yet, they are derived once from the layout of the floating-window versions: `workspace-store` v0, else `panel-layouts-store` + `workspace-z-index-store` (the shape the oldest versions left), else the pane and category positions of `app_state.json`. The Image and Generation pane widths become the region widths (clamped); a region whose panes were all closed starts collapsed; the details panel opens on the Used sub-prompts tab when only that pane was open, and is closed when both the Output browser and the Used sub-prompts panes were. The category windows give the board order, read top to bottom, grouped into rows (tops within 64 px), then left to right (ties go to the front window); panes and deleted categories are dropped, categories without a window come last, every card starts expanded, and free positions are dropped. The legacy files are only read, never written or deleted.
- `library-store` is version 2: entries may carry a `source` (model library provenance), and the LoRA selection is `selectedLoras: [{id, weight}]`. Older data migrates on load: version 0 entries get `source: null`, and the `selectedLoraIds` of versions 0 and 1 become `selectedLoras` at weight 1. The `last_lora_ids` of a legacy `app_state.json` seed the selection at weight 1 too.
- `story-store` (version 0) holds the Story section's dock collapse (`{"dockCollapsed": bool}`); it starts expanded when absent or of another shape.
- `backend_settings.json` (version 1) may hold `"codex": {"path", "model"}` next to `provider_tokens`; files without it load unchanged (auto-detect, the default model), and every write keeps the other settings. `<data dir>/codex/conversations.json` (`{"version": 1, "conversations": [{"id", "thread_id", "story_ids", "draft"}]}`) indexes the co-writer's conversations into Codex's own history; it is derived data (an unreadable file reads as empty) and safe to delete.
- The backend owns the favorite online images (`<data dir>/image_favorites.json`, version 1), the characters (`<data dir>/characters/characters.json`, version 1, plus `characters/images/*.png`; see Characters) and the stories (`<data dir>/stories/stories.json`, version 1; see Story). Both start empty when their file does not exist. Output metadata files gained an optional `story` key; files without it load unchanged (no migration needed, nothing is rewritten).
- The frontend reads outputs through the backend API: `/api/outputs`, `/api/outputs/{id}`, `/api/outputs/{id}/image`, `/api/outputs/{id}/thumbnail` (a WebP of at most 256 px, made on first request and remade when the picture is newer; cached in `<data dir>/cache/output_thumbnails`, derived data that is safe to delete; 404 for an unknown output, 422 for an invalid id), `/api/outputs/{id}/trash` and `/api/trash/{id}/restore`.

### Extension points

- **New sections:** add or extend a store in `src/stores` (logic in `src/domain`), then the view in `src/features/<area>` (a full page on `src/ui/SectionLayout.tsx`, panels with `src/ui/PaneLayout.tsx`), then the section id, name, description and command in `src/app/sections.ts` (and its key binding), and its view and rail icon in `src/shell/sectionViews.tsx`. The rail, `Ctrl+<n>`, the F6 regions and the e2e `AppDriver` follow from those names.
- **New API areas:** add `backend/app/routers/<area>.py` exposing an `APIRouter`, append it to `ROUTERS`, put its logic in a service wired in `services/container.py`, add its models to `schemas.py`, then run `npm run gen:api` and add the client calls to `src/api/client.ts`.
- **Live messages:** `/ws/tasks` also carries messages that are not tasks (the co-writer's `CodexEvent`, `type` "codex"), sent with `TaskHub.broadcast` (never recorded in `GET /api/tasks`). A model only sent over the socket is listed in `EXPORTED_MESSAGE_TYPES` (`schemas.py`): `factory.py` adds it and the schemas it uses to the OpenAPI components, so `npm run gen:api` generates its TypeScript types.
- **Co-writer tools:** add the name to `CodexToolName`, its arguments model to `CODEX_TOOL_ARGUMENTS` (`schemas.py`: descriptions, defaults and `_examples`; the tests validate every example and want a valid and an invalid call of every tool), its description to `CODEX_TOOLS` (`services/codex/tools.py`), and its handler to `TOOLS` in `src/stores/coWriterTools.ts` (an exhaustive record: the type-check fails without it; it acts through the stores' actions and checks what Codex names first); what it answers goes to `src/domain/coWriterViews.ts`, its running label to `src/domain/coWriter.ts` (exhaustive too), and its row in the capability matrix (Co-writer) to this README.
- **Background tasks:** progress events form one discriminated union, `TaskEvent` = `GenerationTaskEvent | DownloadTaskEvent`, keyed by `task_id` and published through `TaskHub.publish` from any thread. The frontend reads them from `tasksStore` (`useDownloadProgress`, `waitForTask`).
- **Downloads:** `services/downloads.py` `DownloadManager.start(DownloadSpec(url, dest, title, headers, expected_sha256, expected_size), on_complete=...)` is generic: any feature that needs a file gets streaming, verification, retries, cancel (`POST /api/downloads/{task_id}/cancel`) and progress events.
- **Model providers:** implement the `ModelProvider` protocol of `services/model_providers/base.py` (`info`, `search`, `get_version`, `find_by_hash`, `download_source`; run every version through `complete_version` so the shared install rules apply) and add it to the registry in `services/container.py`. A Hugging Face provider would plug in there; the API, the install flow and the UI take the provider id from `GET /api/models/info`.
- **New shortcuts:** add the command to `APP_COMMANDS` and its handler in `src/app/commands.ts`, and the binding to `keymap.json` (a test checks both agree).
- **Story dock panels:** add `{ label, component }` to `STORY_DOCK_PANELS` (`src/features/story/storyDock.ts`); the component works through the story store's actions (see Story).
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

### Stories API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/stories` | every story with its scenes, in creation order |
| `POST /api/stories` | creates a story (`{"title", "character_ids", "logline", "synopsis", "style_notes"}`) |
| `GET` / `PATCH` / `DELETE /api/stories/{id}` | one story; PATCH changes the fields sent (title, character_ids, logline, synopsis, style_notes; none accepts null); DELETE keeps its outputs |
| `GET /api/stories/{id}/export` | the story as one self-contained HTML document (`text/html`) |
| `PUT /api/stories/{id}/scene-order` | `{"scene_ids": [...]}`: every scene id of the story once, in the new order |
| `POST /api/stories/{id}/scenes` | adds a scene (`SceneCreateRequest`: fields, `index`, `output_id` = its first variant and picture); untitled: 'Scene <n>' |
| `PATCH` / `DELETE /api/stories/{id}/scenes/{scene_id}` | changes the fields sent (title, text, beat, shot, setting, mood, extra_tags, negative_tags, locks, loras (`[{"id", "weight"}]`), character_ids, seed; only character_ids and seed accept null) / deletes the scene |
| `POST /api/stories/{id}/scenes/{scene_id}/duplicate` | inserts a copy after it ('<title> (copy)') |
| `POST /api/stories/{id}/scenes/{scene_id}/variants` | `{"output_id"}`: an existing output becomes a variant and the picture |
| `PUT /api/stories/{id}/scenes/{scene_id}/chosen` | `{"output_id"}`: picks one of the variants |
| `DELETE /api/stories/{id}/scenes/{scene_id}/variants/{output_id}` | removes a variant (the output is kept) |

Every scene change answers the whole story. A generation request names a scene with `story: {"story_id", "scene_id"}` (409 for an unknown one, before anything is generated). Errors: 404 for an unknown story, scene, variant or output; 422 for an invalid body (a blank title, a null text, an order that is not a permutation); 503 when `stories.json` cannot be read (it is then never overwritten).

### Co-writer API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/codex/status?refresh=` | `CodexStatus`: `state` (`ready`, `not_found`, `signed_out`, `error`), `message` (what to do), the executable (`path`, `source`), `version`, `configured_path`, `searched` (when not found), `account` (`chatgpt`, `api_key`: never the credentials), `default_model`, `model`, `models`, `running`. Looks for Codex once; `refresh` (Retry) looks again |
| `PUT /api/codex/settings` | `{"path"?, "model"?}`: only the fields sent change, null clears (auto-detect, the default model); a new path looks for Codex again (409 while Codex answers) |
| `GET /api/codex/conversation?story_id=` | the conversation of a story (without `story_id`: the draft one); its history is read from Codex the first time. 404 for an unknown story |
| `POST /api/codex/conversation/reset` | `{"story_id"}`: New conversation; answers the empty one. 409 while it runs |
| `POST /api/codex/turns` | `{"story_id", "scene_id", "text", "client_id"}`: sends the user's message (starting Codex when needed); answers the conversation with it, the answer streams over `/ws/tasks`. 409 when Codex cannot work (the reason) or is still answering; a failure to reach Codex shows as an error entry |
| `POST /api/codex/conversations/{id}/interrupt` | Stop |
| `POST /api/codex/tool-calls/{call_id}/result` | `CodexToolResult` (`ok`, `text` for Codex, `summary` for people, `story_id`, `scene_id`) of a call the window ran; 404 when the call is over |

`/ws/tasks?client_id=<window>` streams `CodexEvent` messages (`type` "codex", by `kind`): `status`, `conversation` (a whole conversation), `entry` (an entry added or replaced), `delta` (streamed text), `tool_call` (for the window `client_id` to run), `tool_cancel` (abandoned). Conversations, entry and delta events carry the conversation's `revision`: the frontend drops anything older than what it shows (an HTTP answer can arrive after the events). The MCP server is not part of this API: it listens on its own 127.0.0.1 port for the Codex process only.

### IP-Adapter API

| Endpoint | Purpose |
| --- | --- |
| `GET /api/ip-adapters?model_path=` | every IP-Adapter variant with its files (`local_path` when on disk, `task_id` while downloading) and `ready`, the two folders, and for `model_path` its family (`architecture`) and one `ReferenceSupport` per focus (`variant_id`, `ready`, `reason` when references cannot apply) |
| `POST /api/ip-adapters/{variant_id}/install` | `installed` when every file is on disk, else `downloading` with one task id per missing file (progress on `/ws/tasks`, cancel with `POST /api/downloads/{task_id}/cancel`); 404 for an unknown variant |

## Stack

- Backend: FastAPI, Pydantic v2, uvicorn, Pillow, httpx (outgoing HTTP), `diffusion-lora-runtime` (editable path dependency), managed with `uv`, tested with pytest. The co-writer needs the user's own Codex (the OpenAI Codex app or the Codex CLI, signed in); without it the panel says how to get it.
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

Tests never touch the real data directory, the model folders or the network, never load a real model and never start the user's Codex (the test app finds no Codex; the co-writer tests and the e2e backend use the scripted fake app-server `backend/tests/fake_codex.py`, which speaks the app-server protocol and calls the app's MCP server over HTTP like the real Codex). The backend tests point `PROMPT_WEAVER_DATA_DIR` and the model folders at a temp dir and use a fake generator. Every outgoing request is answered by `FakeHttp` (real trimmed Civitai answers live in `tests/fixtures/civitai`), and any other request to a non-loopback host fails the test. No model, GPU or network is needed.

```powershell
cd backend
uv run pytest              # 965 tests: API tests (TestClient), service unit tests, the download manager against a
                           # local HTTP server, the install, image library, character and story flows end to end, the
                           # co-writer with the fake Codex app-server (discovery, login states, streaming, MCP tools and
                           # their security, every tool's valid and invalid calls and schemas, pictures as MCP image
                           # content, Stop, crash and restart, resume), and the e2e backend itself (tests/e2e: reset,
                           # fake generator, synthetic Civitai, fake Codex)

cd frontend
npm test                   # 1588 Vitest tests: domain, stores (every co-writer tool over the real stores), persistence,
                           # API client, components, Electron helpers
npm run test:e2e           # 426 Playwright tests in the real browser (213 per theme; about 30 min; see below)
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

### Generation benchmark (real GPU)

`backend/scripts/bench_generation.py` measures generation speed with real model files (it is not part of any test
suite). For each generation of a fixed sequence (cold, no LoRA x N, LoRAs x N, a weight change, a LoRA set change, no
LoRA again x N) it reports the wall time, the setup time (model / LoRA / IP-Adapter changes, textual inversions, prompt
encoding), the first step, the sampling speed (it/s over steps 2..N) and the finish time (VAE decode, saving); `--gpu`
adds GPU utilization, peak VRAM, peak shared GPU memory (VRAM spilled into system RAM) and the lowest available RAM,
`--probe` the worst `/api/health` answer time during each generation (how long other UI requests waited).

```powershell
cd backend
# the runtime alone, in this process (stop any backend first: one GPU process at a time)
uv run python scripts/bench_generation.py runtime --model <checkpoint.safetensors> --lora <lora.safetensors>[=weight] --lora ... --gpu --json out.json
# end to end through a running backend (POST /api/generate; start it with PROMPT_WEAVER_DATA_DIR pointing at a temp dir)
uv run python scripts/bench_generation.py http --url http://127.0.0.1:8000 --model <checkpoint> --lora ... --gpu --probe
```

Defaults: 768 x 1344, 30 steps, CFG 3, seed 1234, `--repeat 3`; `--prompt` / `--negative` accept inline `<lora:...>`
tags and `embedding:name`, `--sequence` picks scenarios (`cold,base,loras,weight,set,none,base-after`). The script uses
only the public generate API and stdlib HTTP, so it also measures older versions (run it with their interpreter).

Reference (RTX 4060 Ti 16 GB, bubbleHentai_v20 SDXL fp16, model CPU offload, defaults): no LoRA 26.1 s at 1.65 it/s,
3 LoRAs 42 s at 0.94 it/s (unfused PEFT adapters), weight change 42 s, LoRA set change 46 s (incremental; a full
reload was 52-62 s before `diffusion-lora-runtime` 0.4.0), peak VRAM 5.5 GB allocated / 7.4 GB reserved by torch.

Component tests render through the app's real root providers (`src/test/render.tsx` wraps `AppProviders` with the theme forced to light; pass `colorScheme: 'dark'` for the dark theme), so they exercise the provider configuration the app ships with.

### End-to-end tests in the real browser

jsdom does no layout or painting, so it cannot prove that anything is visible. The Playwright suite in `frontend/e2e` drives the real app in the installed Microsoft Edge (channel `msedge`, headless, 1920 x 1080; no browser download), once with the dark and once with the light color scheme:

```powershell
cd frontend
npm run test:e2e                     # every spec, dark and light projects
npm run test:e2e -- e2e/smoke.spec.ts --project dark
npm run test:e2e:update              # rewrite the visual baselines that no longer match, then look at every changed PNG
npx playwright test --update-snapshots=all          # rewrite every baseline (after a change that shows everywhere)
npm run test:e2e:update -- e2e/models e2e/images    # only the baselines of some areas
npm run test:e2e:electron            # the Electron smoke test (opens a desktop window; not part of test:e2e)
```

The specs, one folder per area (each spec runs in both projects, dark and light):

| Folder | Covers |
| --- | --- |
| `smoke.spec.ts` | every section is visible (no portal overlay, no blank screen) with no page overflow, the docked regions never overlap and Generate is on top, tooltips create no overlay, baselines of every section at 1920 x 1080 and 1280 x 720 |
| `shell/` | the rail (click, `Ctrl+1..5`, `aria-current`, focus, tooltips, About and the data directory), splitters (drag and keyboard, limits, saved widths), collapse and the strips (generate from the collapsed panel), the `Ctrl+H` cycle, the 1280 x 720 fit, F6 / Shift+F6 and `Ctrl+F`, the layout migration from the floating-window stores, the Downloads indicator and the Models badge, toasts (placement clear of Generate, Go to Create), boot spinner and failure + Retry |
| `categories/` | the board (grid without overlap, search and state filter, collapse and collapse all, reorder by drag and by keyboard, Sort by priority with the button and `Ctrl+O`, reveal on Add category, the empty board, the legacy order), a 320 px board at 1280 x 720, the state colors of rows, cards and the Used sub-prompts list (computed colors against `stateColors.ts`, contrast, non-color cues, element baselines), category flows (create, rename, priority, activation text, skip, lock, add / edit / delete sub-prompts, bulk edit, delete with confirmation), forbidden rule flows |
| `generation/`, `outputs/`, `library/` | Generate / Continuous / Cancel with progress, a failing generation, the Checkpoint picker, the no-model call to action, More options, the sticky actions at 1280 x 720 and in the narrowest panel, the command bar (model, character, LoRA weights), the viewer (output actions, arrow keys and buttons, Copy prompt, trash and undo, missing pictures, the empty history, the narrowest viewer), the filmstrip (thumbnails, keyboard, Jump to latest, 44 outputs), the details tabs and their persistence, LoRA weights (typed, stepped, clamped, saved, used by the generation) |
| `models/`, `images/` | search and filters, the result grids and detail panels (selection, `Escape` and focus return, 1280 x 720), statuses, downloads with progress, Cancel, stalls, Failed + Retry / Dismiss, resumed downloads, embeddings, the token dialog, the Local library, the image grid, Load more and infinite scroll, Use these LoRAs, Use this checkpoint, favorites, Add to category, the hand-off toasts landing in Create |
| `characters/` | the gallery (search, selection, details, activation), the editor (new, edit, validation, reference images, delete, focus), Create character from an output and from an image, the Character section of the generation panel (300 px), generation with an active character, the IP-Adapter section (download, stall + Cancel, failure), 1280 x 720 |
| `story/` | the co-writer telling a whole story with the fake Codex scripted to call the app's tools (`coWriterJourney.spec.ts`: a character and the outline in one call, per-frame tags, locks, LoRAs and seeds in bulk, a preview of the prompt, every scene illustrated, a look at the pictures (MCP image content) and a consistency report, a fix with a new seed, picture and reference image; the storyboard, the scene details and the backend checked after each step; dock baseline), Markdown answers (formatted, no HTML, safe links; baselines), the co-writer with the fake Codex (a streamed answer, Enter / Shift+Enter, tool calls that add and edit a scene in the storyboard and illustrate one with the fake generator, Stop of an answer and of a generation, not found then the path set, not signed in then Retry, the conversation after a reload and New conversation, 1280 x 720 expanded and collapsed, F6 to the strip; panel baselines), the storyboard (stories, scene cards, scene details, docked; 1280 x 720 with the co-writer collapsed), create a story and add / edit / duplicate / delete scenes (saved), reorder by keyboard and by drag, generate a scene and every missing scene with the fake generator (progress, Cancel), character consistency (the story character's tags, LoRA and locked seed in every scene's output, a scene's own character), regenerate and pick a variant, a failing generation, Add to story from Create (an existing story, a new one, Go to Story), Use the current output, read mode (keys, buttons, Escape; 1280 x 720), Export (the downloaded HTML, opened on its own), the story's flow (logline, synopsis and style notes in their disclosure; baseline), a scene's flow notes and LoRAs with their weights (added, stepped, removed; saved), removing a variant at 1280 x 720 (the picture falls back, the output is kept) |
| `journeys/` | task flows across sections: the first run (empty app guidance, Browse models, Use a checkpoint, add a category, Generate), compose + generate + review, remix an online image (Use these LoRAs, tags to a new category, Generate), keep a character (create from an output, activate, two outputs with the same locked seed), download a model and use it, and a board of 42 categories (no overlap, search, collapse all, reorder) |

- Servers: each run starts its own e2e backend and Vite dev server, on `E2E_BACKEND_PORT` / `E2E_FRONTEND_PORT` (default 18100 / 15200; set other ports to run several suites side by side, e.g. `E2E_BACKEND_PORT=18101 E2E_FRONTEND_PORT=15201 npx playwright test e2e/categories`). Vite runs with HMR off and its own dependency cache per port; Playwright's output goes to `test-results/e2e-<frontend port>`. `frontend/e2e/support/env.ts` owns the ports, URLs and shared Playwright settings.
- The e2e backend (`backend/tests/e2e/server.py`, never imported by production code) runs the real `create_app` on a temp data dir and temp model folders seeded from synthetic fixture data (`backend/tests/e2e/fixtures`: every visual state of categories, prompts, forbidden rules, outputs, the library with LoRA weights, characters, stories), with a paced fake generator (a real picture, one progress event per step, cancellable) and a synthetic Civitai / Hugging Face (`fake_civitai.py`: search, versions, images, downloads with progress, stalls and cancel). The browser's requests to other hosts go to the same synthetic network. Before every test, `POST /__e2e__/reset` gives the test a fresh app on fresh data. Its options (`backend/tests/e2e/options.py`, set per test with `test.use({ e2eOptions })`):
  - `generator`: `step_delay_ms` (default 60 per step), `fail_message` (every generation fails with it);
  - `codex`: the user's Codex as the co-writer finds it, the fake app-server (`backend/tests/fake_codex.py`): `installed` (false: not found until the panel is given its path, `E2EState.codex_path`), `account` (null: not signed in), `delta_delay_ms` (default 25), `rules` (`{match, steps}`: what it says, which app tools it calls; a tool step's `as` names its result, and placeholders read the last or a named result, its JSON included: `{last.json.scenes.0.scene_id}`, `{lina.json.character_id}`, `{seen.images}`), `default_steps`, `fail_start`. `POST /__e2e__/codex` changes its scenario during a test (e.g. `{"account": "chatgpt"}`: signed in meanwhile);
  - `network`: `chunk_delay_ms` (default 150), `download_chunks` (MiB per file, default 6), `stall_at_percent` (downloads stop there until cancelled), `corrupt_downloads` (the first N Civitai downloads fail their SHA-256 check, later ones succeed), `civitai_error_status` (e.g. 503), `civitai_delay_ms`;
  - `files`: data dir files written over the fixture data (`storeFile` and `fixtureStoreFile` in `e2e/support/backend.ts`, `layoutStoreFile` in `e2e/support/shell.ts`);
  - `remove`: data dir files or folders deleted once everything is seeded (`output` for an empty history, `output/0000000004.png` for an output whose picture is missing, `characters`, `stories`, `stores/board-store` + `stores/layout-store` to migrate the fixture's legacy `workspace-store` v0).
- The synthetic catalog (`fixtures/civitai_catalog.json`) has LoRAs, checkpoints and an embedding in every status (to download, in the library, on disk, not supported, refused pickle file, NSFW), and a feed of 24 safe, locally usable images on two pages plus special images (NSFW, Flux, unidentified LoRA, no generation data).
- `AppDriver.settle()` also waits for a shown co-writer panel to know whether Codex can be used (`data-co-writer-state` other than `checking`).
- Every test fails on a console error, an uncaught page error or a request the synthetic network could not answer. `expectDockedLayout` (`e2e/support/shell.ts`) checks that the rail, the Create header and the three regions tile the window without overlapping and that Generate is on top; `expectNoPageOverflow` that nothing scrolls horizontally. `assertAppVisible` samples the viewport with `elementFromPoint` and fails when a Fluent portal mount node, an unexpected overlay or nothing covers the app, or when the screen is (nearly) one color; `expectOnTop` checks that one element is not covered; `expectNoHorizontalOverflow` that nothing sticks out of a window. State colors are compared with the token table (`resolveColor`, `computedStyle`) and text contrast is measured on the painted colors (`textContrast`, `expectReadable`).
- Wait for the app's own save before reading a persisted store (`savedStore(page, name, accepts)`, called before the action), then read it with `backend.storedState(name)`.
- Screenshots the tests save for inspection go to `frontend/e2e/.screens` (ignored by git); visual baselines (`expectBaseline`, volatile content masked) are committed under `frontend/e2e/__screenshots__/<spec>/<project>/`.
- The backend side of the e2e server is tested by `backend/tests/e2e/test_server.py` and `test_fake_civitai.py` (part of `uv run pytest`).

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
- The co-writer uses the app-server protocol of the installed Codex (checked with codex-cli 0.169.0-alpha.11.1: `codex app-server generate-json-schema` / `generate-ts` emit it). Optional requests it may lack (`config/read`, `experimentalFeature/list`, `model/list`) are skipped; an app-server without `thread/turns/list` gets the history through `thread/read`. Codex keeps its threads in the user's Codex home, so the co-writer's conversations are listed there too.
