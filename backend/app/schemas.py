"""Pydantic API schemas: the single source of truth for data shared with the frontend.

Every model here is exported through the FastAPI OpenAPI document and turned into
TypeScript types (frontend/src/api/schema.gen.ts) by `npm run gen:api` in frontend/.
Never hand-write a TypeScript mirror of these models; import the generated aliases
from frontend/src/api/types.ts instead.

After changing this module run, from frontend/:  npm run gen:api
(backend/tests/test_openapi_snapshot.py and frontend/src/api/apiTypes.test.ts fail
until the snapshot and the generated types are refreshed).
"""

from __future__ import annotations

from datetime import datetime
from typing import Annotated, Any, Literal, TypeVar, Union

from pydantic import BaseModel, ConfigDict, Field, SecretStr, model_validator

# ---------------------------------------------------------------------------
# Shared literals
# ---------------------------------------------------------------------------

SeedMode = Literal["random", "manual"]
SeedAdvanceMode = Literal["keep", "increment", "randomize"]
SeedBehavior = Literal["fixed", "increment", "randomize", "per_category_cycle"]
MatcherKind = Literal["specific", "contains", "tag"]
TorchDType = Literal["float16", "bfloat16", "float32"]

# Output ids are fixed-width 10-digit numbers (0000000001).
OUTPUT_ID_PATTERN = r"^\d{10}$"
# Names of frontend persisted stores (directory names under <data_dir>/stores).
STORE_NAME_PATTERN = r"^[a-z0-9][a-z0-9-]{0,63}$"



class ApiModel(BaseModel):
    """Base of every API model: fields with defaults are optional in request schemas but required in
    response schemas, so the generated TypeScript response types never need frontend-side defaults."""

    model_config = ConfigDict(json_schema_serialization_defaults_required=True)


# ---------------------------------------------------------------------------
# Defaults shared with the frontend
# ---------------------------------------------------------------------------

# Models decorated with @export_defaults are added to the OpenAPI components with this flag (factory.py), even
# when no route references them, and `npm run gen:api` exports their field defaults as frontend constants in
# frontend/src/api/defaults.gen.ts (GenerationDefaults -> GENERATION_DEFAULTS, ModelSearchQuery ->
# MODEL_SEARCH_QUERY_DEFAULTS). Every field of such a model needs a default (no default_factory).
EXPORT_DEFAULTS_FLAG = "x-export-defaults"
EXPORTED_DEFAULTS_SCHEMAS: list[type[BaseModel]] = []

_ModelT = TypeVar("_ModelT", bound=type[BaseModel])


def export_defaults(model: _ModelT) -> _ModelT:
    EXPORTED_DEFAULTS_SCHEMAS.append(model)
    return model


@export_defaults
class GenerationDefaults(ApiModel):
    """The single definition of the generation setting defaults (the backend models below and the frontend
    generation settings / library stores derive theirs from it)."""

    width: int = 1024
    height: int = 1024
    steps: int = 30
    guidance_scale: float = 7.0
    negative_prompt: str = ""
    prompt_seed: int | None = None
    seed: int | None = None
    prompt_seed_behavior: SeedBehavior = "fixed"
    image_seed_behavior: SeedBehavior = "fixed"
    torch_dtype: TorchDType = "float16"


GENERATION_DEFAULTS = GenerationDefaults()


@export_defaults
class LoraWeightDefaults(ApiModel):
    """The single definition of per-LoRA weights: the default weight (also used for LoRAs requested without one:
    selections persisted before weights existed, prompt-linked LoRAs, images that publish no weight), the
    accepted range and the UI step. Exported to the frontend as LORA_WEIGHT_DEFAULTS."""

    weight: float = 1.0
    min: float = -10.0
    max: float = 10.0
    step: float = 0.05


LORA_WEIGHT_DEFAULTS = LoraWeightDefaults()

# A per-LoRA weight (validated against LORA_WEIGHT_DEFAULTS.min/max).
LoraWeightValue = Annotated[float, Field(ge=LORA_WEIGHT_DEFAULTS.min, le=LORA_WEIGHT_DEFAULTS.max)]


# ---------------------------------------------------------------------------
# Model / LoRA library
# ---------------------------------------------------------------------------


ModelKind = Literal["checkpoint", "lora", "embedding"]


class ModelSource(ApiModel):
    """Provenance of a library entry installed from an online provider (model library). Stored with the entry
    in the frontend library store; null for entries added from local files."""

    provider: str
    model_id: str
    version_id: str
    file_id: str
    model_name: str
    version_name: str
    base_model: str
    sha256: str | None = Field(description="Lowercase hex SHA-256 of the file, when the provider publishes it.")
    preview_url: str | None
    trigger_words: list[str]
    page_url: str | None


class LoRASpec(ApiModel):
    """A LoRA library entry (the frontend library store owns the library)."""

    id: str
    name: str
    path: str
    source: ModelSource | None = None


class LoraWeight(ApiModel):
    """A LoRA applied with a weight: THE representation of per-LoRA weights, end to end. The frontend library
    store's selection ('library-store' selectedLoras) holds these, GenerateRequest.loras carries them with the
    library entry (GenerationLoRA), OutputRecord.active_loras records them, and services/runtime_adapter.py passes
    the weight to the runtime LoRASpec."""

    id: str = Field(description="LoRA library entry id (LoRASpec.id).")
    weight: LoraWeightValue = LORA_WEIGHT_DEFAULTS.weight


class GenerationLoRA(LoRASpec, LoraWeight):
    """A library LoRA requested for a generation with its weight (LoRASpec fields + LoraWeight.weight)."""


class ModelSpec(ApiModel):
    id: str
    name: str
    path: str
    default_width: int = GENERATION_DEFAULTS.width
    default_height: int = GENERATION_DEFAULTS.height
    torch_dtype: TorchDType = GENERATION_DEFAULTS.torch_dtype
    source: ModelSource | None = None


class LibraryState(ApiModel):
    """Legacy library.json format (read at bootstrap to seed the frontend library store)."""

    models: list[ModelSpec] = Field(default_factory=list)
    loras: list[LoRASpec] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Legacy app_state.json format (read-only; seeds frontend stores on first run)
# ---------------------------------------------------------------------------


class PromptEntry(ApiModel):
    id: str | None = None
    text: str
    skipped: bool = False
    extra_lora_ids: list[str] = Field(default_factory=list)


# Legacy window geometry carries no defaults: a missing or incomplete layout imports no window, so the
# frontend's own defaults apply (workspace/paneRegistry.tsx, categories' default card layout).


class CategoryPosition(ApiModel):
    x: int | None = None
    y: int | None = None


class CategorySize(ApiModel):
    width: int | None = None
    height: int | None = None


class PromptCategory(ApiModel):
    id: str
    name: str
    muted: bool = False
    priority: str | None = Field(default=None, description="null: the frontend's default priority.")
    activation_text: str = ""
    locked_prompt_id: str | None = None
    locked_prompt_text: str | None = None
    position: CategoryPosition | None = None
    size: CategorySize | None = None
    z_index: int | None = None
    prompts: list[PromptEntry] = Field(default_factory=list)


class ForbiddenMatcher(ApiModel):
    """One side of a forbidden rule. Also the persisted format of the frontend forbidden-rules store."""

    kind: MatcherKind = "specific"
    category_name: str | None = None
    prompt_text: str | None = None
    contains_text: str | None = None
    tag_text: str | None = None


class ForbiddenRule(ApiModel):
    left: ForbiddenMatcher
    right: ForbiddenMatcher


EditorTargetKind = Literal[
    "none",
    "category-name",
    "category-condition",
    "category-priority",
    "sub-prompt",
    "category-bulk-prompts",
]
EditorVisibilityMode = Literal["all", "categories-only", "panes-only"]


class EditorTarget(ApiModel):
    kind: EditorTargetKind = "none"
    category_id: str | None = None
    prompt_id: str | None = None


class EditorState(ApiModel):
    overlays_hidden: bool = False
    visibility_mode: EditorVisibilityMode = "all"
    selected_category_id: str | None = None
    selected_prompt_id: str | None = None
    editing_target: EditorTarget = Field(default_factory=EditorTarget)


class PaneLayout(ApiModel):
    x: int
    y: int
    width: int
    height: int
    z_index: int | None = None


class WorkspaceLayout(ApiModel):
    image: PaneLayout | None = None
    controls: PaneLayout | None = None
    details: PaneLayout | None = None
    used: PaneLayout | None = None


class AppState(ApiModel):
    categories: list[PromptCategory] = Field(default_factory=list)
    forbidden_rules: list[ForbiddenRule] = Field(default_factory=list)
    last_model_id: str | None = None
    last_lora_ids: list[str] = Field(default_factory=list)
    last_model_dir: str | None = None
    last_lora_dir: str | None = None
    width: int = GENERATION_DEFAULTS.width
    height: int = GENERATION_DEFAULTS.height
    steps: int = GENERATION_DEFAULTS.steps
    guidance_scale: float = GENERATION_DEFAULTS.guidance_scale
    prompt_seed: int | None = GENERATION_DEFAULTS.prompt_seed
    seed: int | None = GENERATION_DEFAULTS.seed
    seed_mode: SeedMode = "manual"
    seed_advance_mode: SeedAdvanceMode = "keep"
    prompt_seed_behavior: SeedBehavior = GENERATION_DEFAULTS.prompt_seed_behavior
    image_seed_behavior: SeedBehavior = GENERATION_DEFAULTS.image_seed_behavior
    negative_prompt: str = GENERATION_DEFAULTS.negative_prompt
    workspace: WorkspaceLayout = Field(default_factory=WorkspaceLayout)
    editor: EditorState = Field(default_factory=EditorState)
    last_output_id: str | None = None


# ---------------------------------------------------------------------------
# Outputs
# ---------------------------------------------------------------------------


class GenerationSelection(ApiModel):
    """One category -> sub-prompt choice used for a generation (stored in output metadata)."""

    category_name: str
    prompt_text: str
    locked: bool = False
    induced_lora_ids: list[str] = Field(default_factory=list)


class OutputRecord(ApiModel):
    """Metadata of one generated image (the adjacent <output_id>.json file).

    The image itself is served by GET /api/outputs/{output_id}/image.
    """

    output_id: str
    image_path: str
    metadata_path: str
    generated_at: datetime
    prompt: str
    seed: int
    width: int
    height: int
    negative_prompt: str = GENERATION_DEFAULTS.negative_prompt
    steps: int = GENERATION_DEFAULTS.steps
    guidance_scale: float = GENERATION_DEFAULTS.guidance_scale
    model_id: str
    prompt_seed: int | None = None
    image_seed: int | None = None
    active_loras: list[LoraWeight] = Field(
        default_factory=list,
        description="LoRAs applied (selected + prompt-linked) with their weights. Files written before per-LoRA "
        "weights hold `active_lora_ids` instead: they load as weight LORA_WEIGHT_DEFAULTS.weight.",
    )
    selections: list[GenerationSelection] = Field(default_factory=list)

    @model_validator(mode="before")
    @classmethod
    def _migrate_active_lora_ids(cls, data: Any) -> Any:
        """Legacy output metadata (`active_lora_ids: [id, ...]`, every LoRA applied with the default weight) ->
        `active_loras`. The legacy key is ignored when `active_loras` is present."""
        if isinstance(data, dict) and "active_loras" not in data and "active_lora_ids" in data:
            legacy_ids = data["active_lora_ids"] if isinstance(data["active_lora_ids"], list) else []
            data = {
                **data,
                "active_loras": [
                    {"id": lora_id, "weight": LORA_WEIGHT_DEFAULTS.weight}
                    for lora_id in legacy_ids
                    if isinstance(lora_id, str)
                ],
            }
        return data


class OutputIndex(ApiModel):
    """Ids of every complete output (both .png and .json present), ascending."""

    ids: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


class GenerateRequest(ApiModel):
    model: ModelSpec
    loras: list[GenerationLoRA] = Field(
        default_factory=list, description="Active LoRAs (selected + prompt-linked, unique) with their weights."
    )
    prompt: str = ""
    selections: list[GenerationSelection] = Field(default_factory=list)
    width: int
    height: int
    steps: int = GENERATION_DEFAULTS.steps
    guidance_scale: float = GENERATION_DEFAULTS.guidance_scale
    prompt_seed: int | None = None
    seed: int | None = None
    negative_prompt: str = GENERATION_DEFAULTS.negative_prompt


# ---------------------------------------------------------------------------
# Background tasks (progress WebSocket /ws/tasks and GET /api/tasks)
# ---------------------------------------------------------------------------

GenerationStage = Literal[
    "idle",
    "loading_model",
    "loading_loras",
    "sampling",
    "saving",
    "complete",
    "error",
    "cancelled",
]
DownloadStage = Literal["queued", "downloading", "complete", "error", "cancelled"]

GENERATION_TASK_ID = "generation"


class GenerationTaskEvent(ApiModel):
    """Progress of the image generation task (a singleton task with task_id 'generation')."""

    type: Literal["generation"] = "generation"
    task_id: str = GENERATION_TASK_ID
    stage: GenerationStage
    message: str = ""
    current: int = 0
    total: int = 0


class DownloadTaskEvent(ApiModel):
    """Progress of a file download (services/downloads.py DownloadManager). current/total are bytes (total 0 =
    unknown size); task_id is returned by the API call that started the download."""

    type: Literal["download"] = "download"
    task_id: str
    stage: DownloadStage
    title: str = Field(default="", description="What is being downloaded (display name).")
    message: str = ""
    current: int = 0
    total: int = 0


TaskEvent = Annotated[Union[GenerationTaskEvent, DownloadTaskEvent], Field(discriminator="type")]


class TaskSnapshot(ApiModel):
    """Latest event of every known task. The WebSocket sends these events on connect."""

    events: list[TaskEvent] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Model library: online catalogs (providers), installs and downloads
# ---------------------------------------------------------------------------

ModelSort = Literal["most_downloaded", "highest_rated", "newest"]
# Model families diffusion-lora-runtime can load from a single checkpoint file (and whose LoRAs/embeddings it
# can apply). null on a version = not usable locally (e.g. Flux, SD3, video models): it cannot be installed.
ModelArchitecture = Literal["sd15", "sdxl"]
InstallState = Literal["installed", "downloading"]

# Lowercase hex SHA-256 (provider hashes are normalized to lowercase by the backend).
SHA256_PATTERN = r"^[0-9a-f]{64}$"


class ModelDirs(ApiModel):
    """Local folder of every model kind (settings.py owns them; downloads land there)."""

    checkpoint: str
    lora: str
    embedding: str


class BaseModelOption(ApiModel):
    """One base-model filter value of a provider (e.g. Civitai "SD 1.5", "Illustrious")."""

    id: str
    architecture: ModelArchitecture | None


class ModelProviderInfo(ApiModel):
    id: str
    label: str
    kinds: list[ModelKind]
    base_models: list[BaseModelOption]
    sorts: list[ModelSort]
    token_supported: bool
    token_set: bool = Field(description="An API token is stored in the backend settings (its value is never sent).")


class ModelLibraryInfo(ApiModel):
    providers: list[ModelProviderInfo]
    model_dirs: ModelDirs


class ProviderTokenUpdate(ApiModel):
    """PUT body of a provider API token. null or an empty string removes the stored token."""

    token: SecretStr | None = None


@export_defaults
class ModelSearchQuery(ApiModel):
    """Query parameters of GET /api/models/search."""

    provider: str = "civitai"
    query: str = ""
    kinds: list[ModelKind] = Field(default=[], description="Empty = every kind the provider supports.")
    base_models: list[str] = Field(default=[], description="BaseModelOption ids; empty = any.")
    sort: ModelSort = "most_downloaded"
    nsfw: bool = False
    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = Field(default=None, description="ModelSearchPage.next_cursor of the previous page.")


class PreviewImage(ApiModel):
    url: str = Field(description="Thumbnail-sized image URL.")
    width: int | None
    height: int | None
    nsfw: bool


class RemoteFile(ApiModel):
    id: str
    name: str
    size_bytes: int
    sha256: str | None
    format: str | None = Field(description='Provider format label, e.g. "SafeTensor" or "PickleTensor".')
    precision: str | None
    variant: str | None = Field(description='e.g. "pruned" or "full".')
    primary: bool
    downloadable: bool = Field(description="False for formats the app refuses to download (pickle-based files).")
    local_path: str | None = Field(
        description="Known local copy (cheap check: same name and size in the kind's folder, or a cached hash match)."
    )


class RemoteModelVersion(ApiModel):
    id: str
    name: str
    base_model: str
    architecture: ModelArchitecture | None
    trigger_words: list[str]
    published_at: datetime | None
    images: list[PreviewImage]
    files: list[RemoteFile]
    page_url: str | None
    default_file_id: str | None = Field(
        description="File installed when InstallRequest.file_id is null (model_providers/base.py default_file)."
    )
    unavailable_reason: str | None = Field(
        description="Why this version cannot be installed (model_providers/base.py); null when it can."
    )


class RemoteModel(ApiModel):
    provider: str
    id: str
    name: str
    kind: ModelKind
    creator: str | None
    nsfw: bool
    tags: list[str]
    download_count: int
    page_url: str | None
    versions: list[RemoteModelVersion]


class ModelSearchPage(ApiModel):
    items: list[RemoteModel]
    next_cursor: str | None


class InstallRequest(ApiModel):
    """Install (download unless already present) one file of a provider model version."""

    provider: str
    version_id: str
    file_id: str | None = Field(default=None, description="Default: the primary downloadable file of the version.")


class InstalledModel(ApiModel):
    """A model file present on disk, ready to be registered in the library store."""

    kind: ModelKind
    name: str = Field(
        description="Display name (library entry name, download title): '<model name> - <version name>'."
    )
    path: str
    source: ModelSource


class InstallResponse(ApiModel):
    state: InstallState
    task_id: str | None = Field(description="Download task (state 'downloading'): follow it on /ws/tasks.")
    installed: InstalledModel | None = Field(description="Set when state is 'installed'.")


class InstallJob(ApiModel):
    """An install whose download is still running (lets the frontend resume tracking after a reload)."""

    task_id: str
    provider: str
    model_id: str
    version_id: str
    file_id: str
    kind: ModelKind
    title: str = Field(description="Same display name as InstalledModel.name and the download task title.")


# ---------------------------------------------------------------------------
# Image library: online images with their generation data (services/image_library.py)
# ---------------------------------------------------------------------------

ImageSort = Literal["most_reactions", "most_comments", "most_collected", "newest"]
ImagePeriod = Literal["day", "week", "month", "year", "all_time"]


@export_defaults
class ImageSearchQuery(ApiModel):
    """Query parameters of GET /api/images/search.

    Civitai's image API has no free-text filter (it ignores a `query` parameter), so a non-empty `query` is a
    keyword search through the model catalog: services/image_library.py searches the LoRAs and checkpoints
    matching the keyword and pages through their image galleries. `period` only applies to the unfiltered feed
    (an empty `query`): Civitai answers empty or partial pages for a gallery + period."""

    provider: str = "civitai"
    query: str = ""
    sort: ImageSort = "most_reactions"
    period: ImagePeriod = "week"
    nsfw: bool = Field(default=False, description="False: only images rated safe (Civitai nsfwLevel <= 2).")
    usable_only: bool = Field(
        default=True,
        description="Only images made with a base model the local runtime can load (BaseModelOption.architecture).",
    )
    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = Field(default=None, description="ImageSearchPage.next_cursor of the previous page (opaque).")


class ImageResource(ApiModel):
    """A model an image was generated with, as its metadata publishes it (the provider merges its resource lists
    and the inline <lora:name:weight> tags of the prompt into one entry per model)."""

    kind: ModelKind
    name: str | None = Field(description="Name written in the image metadata (often the file name without extension).")
    weight: float | None = Field(description="Published weight (LoRAs); null when the image publishes none.")
    version_id: str | None = Field(description="Provider model version id, when published.")
    hash: str | None = Field(
        description="Published file hash, lowercase hex: a SHA-256 (64) or a short provider hash (Civitai AutoV2 "
        "10 / AutoV3 12); resolvable with the provider's find_by_hash."
    )


class ImageGenerationParams(ApiModel):
    """Generation data published with an image (every field null when absent)."""

    prompt: str | None = Field(description="Prompt as published (inline <lora:...> tags included).")
    clean_prompt: str | None = Field(
        description="prompt without its inline LoRA tags (diffusion_lora_runtime.prompt_lora.strip_prompt_lora_tags):"
        " the text the frontend splits into tags."
    )
    negative_prompt: str | None
    sampler: str | None
    steps: int | None
    cfg_scale: float | None
    seed: int | None
    width: int | None
    height: int | None
    clip_skip: int | None


class RemoteImage(ApiModel):
    provider: str
    id: str
    url: str = Field(description="Full-size image URL.")
    thumbnail_url: str = Field(description="Grid-sized image URL.")
    width: int | None
    height: int | None
    nsfw: bool = Field(description="Rated above the safe level (Civitai nsfwLevel > 2).")
    base_model: str | None
    architecture: ModelArchitecture | None = Field(
        description="Local runtime family of base_model; null when it cannot be loaded locally or is unknown."
    )
    username: str | None
    created_at: datetime | None
    reaction_count: int
    page_url: str
    params: ImageGenerationParams | None = Field(description="null when the image publishes no generation data.")
    resources: list[ImageResource]


class ImageSearchPage(ApiModel):
    items: list[RemoteImage]
    next_cursor: str | None


class ResolveImageResourcesRequest(ApiModel):
    """Look up the models of an image (RemoteImage.resources) at their provider."""

    provider: str
    resources: list[ImageResource]


class ResolvedImageResource(ApiModel):
    """One ImageResource looked up at its provider (by version id, else by hash), in request order."""

    resource: ImageResource
    model: RemoteModel | None = Field(
        description="The model with versions == [the resolved version] (files carry local_path); null when unresolved."
    )
    sha256: str | None = Field(
        description="SHA-256 of the file the image used when known: the published SHA-256, else the resolved "
        "version's default file hash."
    )
    error: str | None = Field(
        description="Why it is unresolved: no version id or hash published, unknown at the provider, provider error."
    )


class FavoriteImage(ApiModel):
    """An image saved to the local favorites collection (<data dir>/image_favorites.json, backend-owned)."""

    image: RemoteImage
    saved_at: datetime


# ---------------------------------------------------------------------------
# Frontend persisted stores (<data_dir>/stores/<name>/state.json)
# ---------------------------------------------------------------------------


class PersistedStoreEnvelope(ApiModel):
    """zustand persist envelope: the partialized store state plus its schema version."""

    state: dict[str, Any]
    version: int = 0


class PersistedStoreRead(ApiModel):
    name: str
    envelope: PersistedStoreEnvelope | None = None


# ---------------------------------------------------------------------------
# Bootstrap / misc
# ---------------------------------------------------------------------------


class BootstrapResponse(ApiModel):
    data_dir: str
    legacy_state: AppState = Field(
        description="app_state.json (or defaults) with LoRA references missing from the library stripped."
    )
    legacy_library: LibraryState = Field(description="library.json (or defaults).")
    persisted_stores: list[str] = Field(
        default_factory=list,
        description="Names of frontend stores that already have persisted data; the others are seeded from legacy_*.",
    )
    output_ids: list[str] = Field(default_factory=list, description="Complete output ids, ascending.")
    current_output_id: str | None = Field(
        default=None,
        description="legacy_state.last_output_id when that output still exists, else the latest output id.",
    )


class HealthResponse(ApiModel):
    status: Literal["ok"] = "ok"


class OkResponse(ApiModel):
    ok: bool = True
