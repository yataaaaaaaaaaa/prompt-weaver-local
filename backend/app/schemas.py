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

from pydantic import AfterValidator, BaseModel, ConfigDict, Field, SecretStr, StringConstraints, model_validator

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
# Story ids are "sty-<12 hex>", scene ids "scn-<12 hex>" (assigned by the backend, services/stories.py).
STORY_ID_PATTERN = r"^sty-[0-9a-f]{12}$"
SCENE_ID_PATTERN = r"^scn-[0-9a-f]{12}$"



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


class OutputReference(ApiModel):
    """How the active character's reference images were used for one output (IP-Adapter)."""

    applied: bool
    variant_id: str | None = Field(description="IpAdapterVariant.id used; null when not applied.")
    strength: float | None = Field(description="IP-Adapter scale used (Character.reference_strength); null when not applied.")
    image_ids: list[str] = Field(description="CharacterImage ids used, in order; empty when not applied.")
    reason: str | None = Field(
        description="Why the references were not applied (no reference image, model family without IP-Adapter, "
        "IP-Adapter not installed); null when applied."
    )


class OutputCharacter(ApiModel):
    """The character active for a generation (snapshot of its id and name when the output was made)."""

    id: str
    name: str
    reference: OutputReference


class StoryLink(ApiModel):
    """The story scene a generation illustrates (GenerateRequest.story)."""

    story_id: str = Field(pattern=STORY_ID_PATTERN)
    scene_id: str = Field(pattern=SCENE_ID_PATTERN)


class OutputStory(StoryLink):
    """The story scene an output was generated for (snapshot of the titles when the output was made). The scene also
    lists the output as one of its variants (Scene.variants, services/stories.py)."""

    story_title: str
    scene_title: str


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
    character: OutputCharacter | None = Field(
        default=None,
        description="The character active for this generation (GenerateRequest.character_id) and how its reference "
        "images were used; null without a character and in files written before characters existed.",
    )
    story: OutputStory | None = Field(
        default=None,
        description="The story scene this output illustrates (GenerateRequest.story); null for other generations and "
        "in files written before stories existed (no `story` key).",
    )

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
    character_id: str | None = Field(
        default=None,
        description="The active character (Character.id). Its identity/outfit tags, negative tags, LoRAs and seed lock "
        "are already part of this request (the frontend prompt engine injects them); the backend applies its reference "
        "images through the IP-Adapter when one is installed for the model's family (services/ip_adapters.py) and "
        "records OutputRecord.character.",
    )
    story: StoryLink | None = Field(
        default=None,
        description="The story scene this generation illustrates. The scene's prompt overrides and characters are already "
        "part of this request (the frontend prompt engine pins them, src/domain/stories.ts); the backend checks that the "
        "scene exists (409 otherwise), records OutputRecord.story and adds the output to the scene's variants as its "
        "chosen illustration.",
    )


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
# Characters (services/characters.py, <data dir>/characters/) and their reference images (IP-Adapter,
# services/ip_adapters.py). The backend owns the character collection and its images; the frontend characters
# store reads and edits it through /api/characters only, and its prompt engine injects the active character into
# the prompt (src/domain/characters.ts).
# ---------------------------------------------------------------------------

# What the reference images should keep: the face (IP-Adapter Plus Face) or the whole subject (IP-Adapter Plus).
ReferenceFocus = Literal["face", "general"]

# Character ids are "chr-<12 hex>", character image ids "img-<12 hex>" (assigned by the backend).
CHARACTER_ID_PATTERN = r"^chr-[0-9a-f]{12}$"
CHARACTER_IMAGE_ID_PATTERN = r"^img-[0-9a-f]{12}$"


@export_defaults
class ReferenceDefaults(ApiModel):
    """The single definition of character reference settings: IP-Adapter strength (default, range, UI step), the
    default focus and how many reference images a character holds. Exported to the frontend as REFERENCE_DEFAULTS."""

    strength: float = 0.6
    min: float = 0.0
    max: float = 1.0
    step: float = 0.05
    focus: ReferenceFocus = "face"
    max_images: int = 4


REFERENCE_DEFAULTS = ReferenceDefaults()

# An IP-Adapter strength (validated against REFERENCE_DEFAULTS.min/max).
ReferenceStrength = Annotated[float, Field(ge=REFERENCE_DEFAULTS.min, le=REFERENCE_DEFAULTS.max)]


def _clean_tags(tags: list[str]) -> list[str]:
    """Tags trimmed, empty ones dropped (splitting prompt text into tags is the frontend's src/domain/text.ts)."""
    return [tag.strip() for tag in tags if tag.strip()]


# Prompt tags (characters, story scenes): trimmed, empty ones dropped.
PromptTags = Annotated[list[str], AfterValidator(_clean_tags)]
CharacterTags = PromptTags
CharacterName = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=120)]


class OutputImageSource(ApiModel):
    """A generated output's image (its PNG in the output folder)."""

    kind: Literal["output"]
    output_id: str = Field(pattern=OUTPUT_ID_PATTERN)


class FileImageSource(ApiModel):
    """A local image file (picked with the desktop file dialog): PNG, JPEG, WebP or BMP."""

    kind: Literal["file"]
    path: str = Field(min_length=1)


class UrlImageSource(ApiModel):
    """An online image (e.g. RemoteImage.url of the image library), downloaded by the backend."""

    kind: Literal["url"]
    url: str = Field(pattern=r"^https?://")


class CharacterImageCopySource(ApiModel):
    """Another image of the same character (e.g. a reference image used as the thumbnail)."""

    kind: Literal["character_image"]
    image_id: str = Field(pattern=CHARACTER_IMAGE_ID_PATTERN)


CharacterImageSource = Annotated[
    Union[OutputImageSource, FileImageSource, UrlImageSource, CharacterImageCopySource],
    Field(discriminator="kind"),
]


class CharacterImage(ApiModel):
    """An image stored with a character (<data dir>/characters/images/<id>.png), served by
    GET /api/characters/{character_id}/images/{image_id}."""

    id: str = Field(pattern=CHARACTER_IMAGE_ID_PATTERN)
    width: int
    height: int
    source: CharacterImageSource = Field(description="Where the image was imported from.")
    added_at: datetime


class CharacterDraft(ApiModel):
    """The editable fields of a character: body of PUT /api/characters/{character_id}, base of the create request
    and of Character."""

    name: CharacterName
    identity_tags: CharacterTags = Field(
        default_factory=list,
        description="Appearance tags that identify the character (face, hair, eyes, body...): the locked sub-prompt of "
        "the pinned 'Character' category while the character is active.",
    )
    outfit_tags: CharacterTags = Field(
        default_factory=list,
        description="Default outfit, kept separate from the identity: the locked sub-prompt of the pinned "
        "'Character outfit' category (no such category when empty).",
    )
    negative_tags: CharacterTags = Field(
        default_factory=list, description="Appended to the negative prompt while the character is active."
    )
    loras: list[LoraWeight] = Field(
        default_factory=list,
        description="Character LoRAs (library entry ids) with their weights, applied while the character is active.",
    )
    seed: int | None = Field(default=None, description="Image seed of the character (e.g. of the output it was made from).")
    seed_locked: bool = Field(
        default=False,
        description="While the character is active, generate with `seed` (the image seed field is left unchanged). "
        "Requires a seed.",
    )
    reference_strength: ReferenceStrength = Field(
        default=REFERENCE_DEFAULTS.strength, description="IP-Adapter strength of the reference images."
    )
    reference_focus: ReferenceFocus = Field(
        default=REFERENCE_DEFAULTS.focus, description="IP-Adapter variant used for the reference images."
    )

    @model_validator(mode="after")
    def _seed_lock_needs_a_seed(self) -> "CharacterDraft":
        if self.seed_locked and self.seed is None:
            raise ValueError("seed_locked requires a seed.")
        return self


class Character(CharacterDraft):
    """A character: a recognizable subject reused across generations (backend-owned, <data dir>/characters/)."""

    id: str = Field(pattern=CHARACTER_ID_PATTERN)
    reference_images: list[CharacterImage] = Field(
        default_factory=list,
        description="Reference images for the IP-Adapter, in order (at most REFERENCE_DEFAULTS.max_images).",
    )
    thumbnail: CharacterImage | None = Field(default=None, description="Gallery picture (a downscaled copy).")
    created_at: datetime
    updated_at: datetime


class CharacterCreateRequest(CharacterDraft):
    """Body of POST /api/characters."""

    reference_sources: list[CharacterImageSource] = Field(
        default_factory=list,
        max_length=REFERENCE_DEFAULTS.max_images,
        description="Imported as reference images, in order, all or nothing (nothing is created when one fails); the "
        "first one also becomes the thumbnail. 'character_image' sources are refused (the character has no image yet).",
    )


class CharacterImageRequest(ApiModel):
    """Body of POST /api/characters/{character_id}/reference-images and PUT /api/characters/{character_id}/thumbnail."""

    source: CharacterImageSource


class ActiveCharacterUpdate(ApiModel):
    """Body of PUT /api/characters/active."""

    id: str | None = Field(description="Character to activate for generation; null deactivates.")


class CharacterCollection(ApiModel):
    """Every character (in creation order) and the active one."""

    items: list[Character]
    active_id: str | None = Field(description="The character active for generation; null when none is.")


IpAdapterFileRole = Literal["adapter", "image_encoder"]


class IpAdapterFile(ApiModel):
    """One file an IP-Adapter variant needs (services/ip_adapters.py IP_ADAPTER_CATALOG owns the catalog)."""

    id: str
    role: IpAdapterFileRole
    name: str = Field(description="Local file name (ComfyUI conventions: models/ipadapter, models/clip_vision).")
    size_bytes: int
    local_path: str | None = Field(
        description="Local copy (same name and size, or a cached hash match in its folder); null when it must be "
        "downloaded."
    )
    task_id: str | None = Field(description="Running download of this file (DownloadTaskEvent on /ws/tasks).")


class IpAdapterVariant(ApiModel):
    """An IP-Adapter usable with one model family and focus (adapter weights + image encoder)."""

    id: str
    label: str
    architecture: ModelArchitecture
    focus: ReferenceFocus
    files: list[IpAdapterFile]
    ready: bool = Field(description="Every file is on disk.")


class ReferenceSupport(ApiModel):
    """Whether reference images can be applied with `focus` to the model asked for: the same rule generation uses
    (services/ip_adapters.py IpAdapterService.resolve)."""

    focus: ReferenceFocus
    variant_id: str | None = Field(description="Variant used for the model's family and this focus; null when none.")
    ready: bool
    reason: str | None = Field(description="Why references cannot be applied now; null when ready.")


class IpAdapterFolders(ApiModel):
    """Where IP-Adapter files live and are downloaded to (settings.py AppPaths)."""

    adapter: str
    image_encoder: str


class IpAdapterStatus(ApiModel):
    """GET /api/ip-adapters: every variant with its files, and the support for a model when model_path is given."""

    variants: list[IpAdapterVariant]
    folders: IpAdapterFolders
    architecture: ModelArchitecture | None = Field(
        description="Pipeline family of model_path (diffusion_lora_runtime.checkpoint_inspection.pipeline_architecture); "
        "null without model_path or when it has no IP-Adapter family."
    )
    support: list[ReferenceSupport] = Field(description="One entry per ReferenceFocus for model_path; empty without it.")


class IpAdapterInstallResponse(ApiModel):
    """POST /api/ip-adapters/{variant_id}/install."""

    state: InstallState
    task_ids: list[str] = Field(
        description="Downloads of the missing files (state 'downloading'; a running download is joined); follow "
        "them on /ws/tasks, then ask GET /api/ip-adapters again."
    )


# ---------------------------------------------------------------------------
# Stories (services/stories.py, <data dir>/stories/): illustrated storyboards. A story is an ordered list of scenes;
# each scene has a title, a narrative text and illustrations generated through the regular generation path with the
# scene's prompt overrides (src/domain/stories.ts pins them like the characters' tags). The backend owns the stories;
# the frontend story store reads and edits them through /api/stories only.
# ---------------------------------------------------------------------------

StoryTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
SceneTitle = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
SceneText = Annotated[str, StringConstraints(max_length=50_000)]
CharacterRef = Annotated[str, Field(pattern=CHARACTER_ID_PATTERN)]
SceneSeed = Annotated[int, Field(ge=0)]


class SceneLock(ApiModel):
    """A sub-prompt chosen for one scene: generated as a pinned category named `category_name` whose locked sub-prompt
    is `prompt_text`, in place of the user category of that name (src/domain/stories.ts sceneCategories)."""

    category_name: str = Field(min_length=1, max_length=200)
    prompt_text: str = Field(min_length=1, max_length=5_000)


class SceneVariant(ApiModel):
    """An output illustrating a scene: generated for it (OutputRecord.story) or added from the outputs."""

    output_id: str = Field(pattern=OUTPUT_ID_PATTERN)
    added_at: datetime


class SceneFields(ApiModel):
    """The editable fields of a scene, all with their defaults (base of the create request and of Scene)."""

    text: SceneText = Field(default="", description="The narrative text of the scene.")
    extra_tags: PromptTags = Field(
        default_factory=list,
        description="Tags added to the prompt of the scene's generations (the locked sub-prompt of a pinned 'Scene' "
        "category).",
    )
    negative_tags: PromptTags = Field(
        default_factory=list, description="Appended to the negative prompt of the scene's generations."
    )
    locks: list[SceneLock] = Field(
        default_factory=list,
        description="Sub-prompts chosen for this scene, in prompt order (one per category; the first one of a category "
        "wins).",
    )
    character_ids: list[CharacterRef] | None = Field(
        default=None,
        description="The characters of this scene, in order; null: the story's characters; []: no character.",
    )
    seed: SceneSeed | None = Field(
        default=None, description="Fixed image seed of the scene's generations (reproducible); null: a new seed each time."
    )


class SceneCreateRequest(SceneFields):
    """Body of POST /api/stories/{story_id}/scenes."""

    title: SceneTitle | None = Field(default=None, description="null: 'Scene <n>' (n = the scene count after adding).")
    index: int | None = Field(default=None, ge=0, description="Position of the new scene (0-based); null appends.")
    output_id: str | None = Field(
        default=None,
        pattern=OUTPUT_ID_PATTERN,
        description="An existing output: the scene's first variant and its chosen illustration (Add to story).",
    )


class ScenePatch(ApiModel):
    """Body of PATCH /api/stories/{story_id}/scenes/{scene_id}: only the fields sent change (character_ids and seed
    accept null; the other fields do not)."""

    title: SceneTitle | None = None
    text: SceneText | None = None
    extra_tags: PromptTags | None = None
    negative_tags: PromptTags | None = None
    locks: list[SceneLock] | None = None
    character_ids: list[CharacterRef] | None = None
    seed: SceneSeed | None = None

    @model_validator(mode="after")
    def _only_nullable_fields_cleared(self) -> "ScenePatch":
        cleared = [name for name in self.model_fields_set if getattr(self, name) is None and name not in _NULLABLE_SCENE_FIELDS]
        if cleared:
            raise ValueError(f"{', '.join(sorted(cleared))} cannot be null.")
        return self


_NULLABLE_SCENE_FIELDS = frozenset({"character_ids", "seed"})


class Scene(SceneFields):
    """One scene of a story."""

    id: str = Field(pattern=SCENE_ID_PATTERN)
    title: SceneTitle
    variants: list[SceneVariant] = Field(default_factory=list, description="Its illustrations, oldest first.")
    chosen_output_id: str | None = Field(
        default=None, description="The variant illustrating the scene (one of `variants`); null: not illustrated yet."
    )
    created_at: datetime
    updated_at: datetime


class StoryCreateRequest(ApiModel):
    """Body of POST /api/stories."""

    title: StoryTitle
    character_ids: list[CharacterRef] = Field(
        default_factory=list, description="The story's characters (Character.id), applied to every scene that does not "
        "name its own."
    )


class StoryPatch(ApiModel):
    """Body of PATCH /api/stories/{story_id}: only the fields sent change (neither accepts null)."""

    title: StoryTitle | None = None
    character_ids: list[CharacterRef] | None = None

    @model_validator(mode="after")
    def _no_null_fields(self) -> "StoryPatch":
        cleared = [name for name in self.model_fields_set if getattr(self, name) is None]
        if cleared:
            raise ValueError(f"{', '.join(sorted(cleared))} cannot be null.")
        return self


class Story(StoryCreateRequest):
    """An illustrated story: its scenes in reading order (backend-owned, <data dir>/stories/stories.json)."""

    id: str = Field(pattern=STORY_ID_PATTERN)
    scenes: list[Scene] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime


class StoryCollection(ApiModel):
    """Every story, in creation order."""

    items: list[Story]


class SceneOrderUpdate(ApiModel):
    """Body of PUT /api/stories/{story_id}/scene-order: every scene id of the story, in the new order."""

    scene_ids: list[str]


class SceneVariantRequest(ApiModel):
    """Body of POST /api/stories/{story_id}/scenes/{scene_id}/variants and PUT .../chosen."""

    output_id: str = Field(pattern=OUTPUT_ID_PATTERN)


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
