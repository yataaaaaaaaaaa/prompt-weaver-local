"""Control API of the e2e backend (tests/e2e/server.py): the single definition of the reset options and of the
state report (the network options belong to the synthetic network, fake_civitai.NetworkOptions). The Playwright
helpers (frontend/e2e/support/backend.ts) send these as JSON.

    POST /__e2e__/reset   body: E2EResetRequest (every field optional) -> E2EState
    GET  /__e2e__/state   -> E2EState
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from .fake_civitai import NetworkOptions


class _Options(BaseModel):
    model_config = ConfigDict(extra="forbid")


class GeneratorOptions(_Options):
    """The paced fake generator (support.FakeGenerator in paced mode: one progress event per requested step)."""

    step_delay_ms: int = Field(default=60, ge=0, le=10_000, description="Wait before each sampling step.")
    fail_message: str | None = Field(
        default=None, description="When set, every generation fails with this message (GenerationFailed)."
    )


class E2EResetRequest(_Options):
    generator: GeneratorOptions = Field(default_factory=GeneratorOptions)
    network: NetworkOptions = Field(default_factory=NetworkOptions)
    files: dict[str, Any] = Field(
        default_factory=dict,
        description="Extra or replaced JSON files of the data dir, written after the fixture data (relative path "
        "-> JSON value), e.g. 'stores/board-store/state.json'. Same placeholders as the fixture files. Output "
        "metadata files (output/<id>.json) get a generated PNG when they have none.",
    )
    remove: list[str] = Field(
        default_factory=list,
        description="Files or folders of the data dir to delete (relative paths), removed after everything else is "
        "seeded, so generated files go too: 'output' (empty history), 'output/0000000004.png' (an output whose "
        "picture is missing), 'characters' (no characters), 'stores/board-store' + 'stores/layout-store' (the layout is "
        "migrated from the legacy floating workspace of the fixture, stores/workspace-store).",
    )


class E2EState(BaseModel):
    data_dir: str
    models_root: str
    resets: int
    unexpected_requests: list[str] = Field(
        description="Outgoing requests the synthetic network had no answer for, since the last reset."
    )
    generations: int = Field(description="Generations run by the fake generator since the last reset.")
