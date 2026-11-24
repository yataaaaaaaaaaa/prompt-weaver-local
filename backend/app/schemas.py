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
from typing import Annotated, Any, Literal, Union

from pydantic import BaseModel, ConfigDict, Field

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
# Model / LoRA library
# ---------------------------------------------------------------------------


class LoRASpec(ApiModel):
    id: str
    name: str
    path: str


class ModelSpec(ApiModel):
    id: str
    name: str
    path: str
    default_width: int = 1024
    default_height: int = 1024
    torch_dtype: TorchDType = "float16"


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


class CategoryPosition(ApiModel):
    x: int = 0
    y: int = 0


class CategorySize(ApiModel):
    width: int = 320
    height: int = 360


class PromptCategory(ApiModel):
    id: str
    name: str
    muted: bool = False
    priority: str = "1"
    activation_text: str = ""
    locked_prompt_id: str | None = None
    locked_prompt_text: str | None = None
    position: CategoryPosition = Field(default_factory=CategoryPosition)
    size: CategorySize = Field(default_factory=CategorySize)
    z_index: int = 50
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
    z_index: int = 1


class WorkspaceLayout(ApiModel):
    image: PaneLayout = Field(default_factory=lambda: PaneLayout(x=420, y=24, width=760, height=760, z_index=3))
    controls: PaneLayout = Field(default_factory=lambda: PaneLayout(x=24, y=24, width=420, height=720, z_index=4))
    details: PaneLayout = Field(default_factory=lambda: PaneLayout(x=1210, y=24, width=360, height=780, z_index=5))
    used: PaneLayout = Field(default_factory=lambda: PaneLayout(x=690, y=320, width=790, height=420, z_index=6))


class AppState(ApiModel):
    categories: list[PromptCategory] = Field(default_factory=list)
    forbidden_rules: list[ForbiddenRule] = Field(default_factory=list)
    last_model_id: str | None = None
    last_lora_ids: list[str] = Field(default_factory=list)
    last_model_dir: str | None = None
    last_lora_dir: str | None = None
    width: int = 1024
    height: int = 1024
    steps: int = 30
    guidance_scale: float = 7.0
    prompt_seed: int | None = None
    seed: int | None = None
    seed_mode: SeedMode = "manual"
    seed_advance_mode: SeedAdvanceMode = "keep"
    prompt_seed_behavior: SeedBehavior = "fixed"
    image_seed_behavior: SeedBehavior = "fixed"
    negative_prompt: str = ""
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
    negative_prompt: str = ""
    steps: int = 30
    guidance_scale: float = 7.0
    model_id: str
    prompt_seed: int | None = None
    image_seed: int | None = None
    active_lora_ids: list[str] = Field(default_factory=list)
    selections: list[GenerationSelection] = Field(default_factory=list)


class OutputIndex(ApiModel):
    """Ids of every complete output (both .png and .json present), ascending."""

    ids: list[str] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Generation
# ---------------------------------------------------------------------------


class GenerateRequest(ApiModel):
    model: ModelSpec
    loras: list[LoRASpec] = Field(default_factory=list)
    prompt: str = ""
    selections: list[GenerationSelection] = Field(default_factory=list)
    width: int
    height: int
    steps: int = 30
    guidance_scale: float = 7.0
    prompt_seed: int | None = None
    seed: int | None = None
    negative_prompt: str = ""


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
    """Progress of a file download. Reserved for the model library batch; nothing publishes it yet."""

    type: Literal["download"] = "download"
    task_id: str
    stage: DownloadStage
    message: str = ""
    current: int = 0
    total: int = 0


TaskEvent = Annotated[Union[GenerationTaskEvent, DownloadTaskEvent], Field(discriminator="type")]


class TaskSnapshot(ApiModel):
    """Latest event of every known task. The WebSocket sends these events on connect."""

    events: list[TaskEvent] = Field(default_factory=list)


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
