from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import BaseModel, Field


SeedMode = Literal["random", "manual"]
SeedAdvanceMode = Literal["keep", "increment", "randomize"]
SeedBehavior = Literal["fixed", "increment", "randomize", "per_category_cycle"]
MatcherKind = Literal["specific", "contains", "tag"]


class LoRASpec(BaseModel):
    id: str
    name: str
    path: str


class ModelSpec(BaseModel):
    id: str
    name: str
    path: str
    default_width: int = 1024
    default_height: int = 1024
    torch_dtype: Literal["float16", "bfloat16", "float32"] = "float16"


class LibraryState(BaseModel):
    models: list[ModelSpec] = Field(default_factory=list)
    loras: list[LoRASpec] = Field(default_factory=list)


class PromptEntry(BaseModel):
    id: str | None = None
    text: str
    skipped: bool = False
    extra_lora_ids: list[str] = Field(default_factory=list)


class CategoryPosition(BaseModel):
    x: int = 0
    y: int = 0


class CategorySize(BaseModel):
    width: int = 320
    height: int = 360


class PromptCategory(BaseModel):
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


class ForbiddenMatcher(BaseModel):
    kind: MatcherKind = "specific"
    category_name: str | None = None
    prompt_text: str | None = None
    contains_text: str | None = None
    tag_text: str | None = None


class ForbiddenRule(BaseModel):
    left: ForbiddenMatcher
    right: ForbiddenMatcher


EditorTargetKind = Literal["none", "category-name", "category-condition", "category-priority", "sub-prompt", "category-bulk-prompts"]
EditorVisibilityMode = Literal["all", "categories-only", "panes-only"]


class EditorTarget(BaseModel):
    kind: EditorTargetKind = "none"
    category_id: str | None = None
    prompt_id: str | None = None


class EditorState(BaseModel):
    overlays_hidden: bool = False
    visibility_mode: EditorVisibilityMode = "all"
    selected_category_id: str | None = None
    selected_prompt_id: str | None = None
    editing_target: EditorTarget = Field(default_factory=EditorTarget)


class PaneLayout(BaseModel):
    x: int
    y: int
    width: int
    height: int
    z_index: int = 1


class WorkspaceLayout(BaseModel):
    image: PaneLayout = Field(default_factory=lambda: PaneLayout(x=420, y=24, width=760, height=760, z_index=3))
    controls: PaneLayout = Field(default_factory=lambda: PaneLayout(x=24, y=24, width=420, height=720, z_index=4))
    details: PaneLayout = Field(default_factory=lambda: PaneLayout(x=1210, y=24, width=360, height=780, z_index=5))
    used: PaneLayout = Field(default_factory=lambda: PaneLayout(x=690, y=320, width=790, height=420, z_index=6))


class AppState(BaseModel):
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


class GenerationSelection(BaseModel):
    category_name: str
    prompt_text: str
    locked: bool = False
    induced_lora_ids: list[str] = Field(default_factory=list)


class OutputSummary(BaseModel):
    output_id: str
    image_path: str
    metadata_path: str
    generated_at: datetime
    prompt: str
    seed: int
    width: int
    height: int


class OutputRecord(OutputSummary):
    negative_prompt: str = ""
    steps: int = 30
    guidance_scale: float = 7.0
    model_id: str
    prompt_seed: int | None = None
    image_seed: int | None = None
    active_lora_ids: list[str] = Field(default_factory=list)
    selections: list[GenerationSelection] = Field(default_factory=list)
    image_base64: str | None = None


class BootstrapResponse(BaseModel):
    state: AppState
    library: LibraryState
    data_dir: str
    outputs: list[OutputSummary] = Field(default_factory=list)
    current_output: OutputRecord | None = None


class GenerateRequest(BaseModel):
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


class GenerateResponse(OutputRecord):
    pass


class ProgressEvent(BaseModel):
    stage: Literal["idle", "loading_model", "loading_loras", "sampling", "saving", "complete", "error"]
    message: str = ""
    current_step: int = 0
    total_steps: int = 0


class HealthResponse(BaseModel):
    status: Literal["ok"] = "ok"
