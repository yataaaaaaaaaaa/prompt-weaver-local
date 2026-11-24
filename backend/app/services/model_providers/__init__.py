"""Registry of the online model providers (services/container.py builds it; Civitai is the only one today).

To add a provider (e.g. Hugging Face diffusers repos): implement base.ModelProvider in a new module of this
package and add an instance in container.build_services. Nothing else changes: the API, the frontend store
and the views list providers from GET /api/models/info.
"""

from __future__ import annotations

from collections.abc import Iterable

from .base import (
    DownloadSource,
    ModelProvider,
    ProviderAuthError,
    ProviderError,
    ProviderNotFoundError,
    UnknownProviderError,
)

__all__ = [
    "DownloadSource",
    "ModelProvider",
    "ModelProviderRegistry",
    "ProviderAuthError",
    "ProviderError",
    "ProviderNotFoundError",
    "UnknownProviderError",
]


class ModelProviderRegistry:
    def __init__(self, providers: Iterable[ModelProvider]) -> None:
        self._providers: dict[str, ModelProvider] = {}
        for provider in providers:
            if provider.id in self._providers:
                raise ValueError(f"Duplicate model provider id {provider.id!r}.")
            self._providers[provider.id] = provider

    def get(self, provider_id: str) -> ModelProvider:
        try:
            return self._providers[provider_id]
        except KeyError:
            raise UnknownProviderError(f"Unknown model provider '{provider_id}'.") from None

    def all(self) -> list[ModelProvider]:
        """Providers in registration order."""
        return list(self._providers.values())
