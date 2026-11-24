"""Service container stored on app.state.services."""

from __future__ import annotations

from dataclasses import dataclass

from ..settings import AppPaths
from .generation import GenerationService, GeneratorFactory
from .legacy_state import LegacyStateService
from .outputs import OutputRepository
from .persisted_stores import PersistedStoreRepository
from .task_hub import TaskHub


@dataclass
class AppServices:
    paths: AppPaths
    legacy: LegacyStateService
    outputs: OutputRepository
    stores: PersistedStoreRepository
    tasks: TaskHub
    generation: GenerationService


def build_services(paths: AppPaths, generator_factory: GeneratorFactory) -> AppServices:
    """Construct every service. Performs no filesystem IO (the lifespan calls paths.ensure_dirs())."""
    outputs = OutputRepository(paths)
    tasks = TaskHub()
    return AppServices(
        paths=paths,
        legacy=LegacyStateService(paths),
        outputs=outputs,
        stores=PersistedStoreRepository(paths.stores_dir),
        tasks=tasks,
        generation=GenerationService(
            paths=paths,
            outputs=outputs,
            tasks=tasks,
            generator_factory=generator_factory,
        ),
    )
