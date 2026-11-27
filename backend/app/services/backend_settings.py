"""Backend-only settings stored in <data dir>/backend_settings.json (AppPaths.settings_file).

Today: provider API tokens (e.g. the optional Civitai token some downloads require) and the co-writer's Codex settings
(the path of the codex executable the user set, the model chosen for the co-writer). Rules:
- a token is stored once, here; providers read it with get_token(provider_id) when they build a request;
- its value never leaves the backend: the API only reports token_set (has_token), it is never logged,
  never put in an exception message, and never included in a repr;
- reads are crash-resilient and writes atomic (services/json_files.py); a missing or unreadable file means
  "no settings" (it is rewritten on the next change); a write keeps every other setting of the file;
- thread-safe (routes run in the threadpool).

File format (version 1; every key optional, files written before the Codex settings existed load unchanged):
    {"version": 1, "provider_tokens": {"civitai": "<token>"}, "codex": {"path": "C:/.../codex.exe", "model": "gpt-..."}}
"""

from __future__ import annotations

import threading
from dataclasses import dataclass, replace
from pathlib import Path
from typing import Any

from .json_files import read_resilient_json, write_json_atomic

SETTINGS_FORMAT_VERSION = 1


@dataclass(frozen=True)
class CodexSettings:
    """The co-writer's settings: the codex executable the user chose (None: auto-detect) and the model (None: the
    model of the user's Codex configuration)."""

    path: str | None = None
    model: str | None = None


@dataclass(frozen=True)
class _Settings:
    tokens: dict[str, str]
    codex: CodexSettings


def _clean_text(value: Any) -> str | None:
    return value.strip() or None if isinstance(value, str) else None


def _parse(payload: Any) -> _Settings:
    """The settings of a file payload; anything that is not a valid version 1 file reads as empty."""
    if not isinstance(payload, dict) or payload.get("version") != SETTINGS_FORMAT_VERSION:
        return _Settings(tokens={}, codex=CodexSettings())
    tokens = payload.get("provider_tokens")
    codex = payload.get("codex")
    return _Settings(
        tokens={
            provider_id: token.strip()
            for provider_id, token in (tokens.items() if isinstance(tokens, dict) else ())
            if isinstance(provider_id, str) and isinstance(token, str) and token.strip()
        },
        codex=CodexSettings(path=_clean_text(codex.get("path")), model=_clean_text(codex.get("model")))
        if isinstance(codex, dict)
        else CodexSettings(),
    )


def _payload(settings: _Settings) -> dict[str, Any]:
    payload: dict[str, Any] = {"version": SETTINGS_FORMAT_VERSION, "provider_tokens": settings.tokens}
    codex = {key: value for key, value in (("path", settings.codex.path), ("model", settings.codex.model)) if value}
    if codex:
        payload["codex"] = codex
    return payload


_UNCHANGED: Any = object()


class BackendSettingsStore:
    def __init__(self, settings_file: Path) -> None:
        self._settings_file = settings_file
        self._lock = threading.Lock()
        # Loaded lazily from the file on first use (construction performs no IO).
        self._settings: _Settings | None = None

    def __repr__(self) -> str:
        # Never the token values.
        return f"{type(self).__name__}(settings_file={str(self._settings_file)!r})"

    def _loaded(self) -> _Settings:
        """The settings (caller holds the lock)."""
        if self._settings is None:
            try:
                payload = read_resilient_json(self._settings_file)
            except OSError:
                payload = None
            self._settings = _parse(payload)
        return self._settings

    def _save(self, settings: _Settings) -> None:
        """Writes the settings (caller holds the lock)."""
        write_json_atomic(self._settings_file, _payload(settings))
        self._settings = settings

    def get_token(self, provider_id: str) -> str | None:
        """The stored token of `provider_id` (None when unset)."""
        with self._lock:
            return self._loaded().tokens.get(provider_id)

    def has_token(self, provider_id: str) -> bool:
        return self.get_token(provider_id) is not None

    def set_token(self, provider_id: str, token: str | None) -> None:
        """Stores the token (surrounding whitespace stripped); None or an empty string removes it."""
        value = (token or "").strip()
        with self._lock:
            settings = self._loaded()
            tokens = dict(settings.tokens)
            if value:
                tokens[provider_id] = value
            else:
                tokens.pop(provider_id, None)
            self._save(replace(settings, tokens=tokens))

    def codex(self) -> CodexSettings:
        with self._lock:
            return self._loaded().codex

    def update_codex(self, *, path: str | None = _UNCHANGED, model: str | None = _UNCHANGED) -> CodexSettings:
        """Changes the Codex settings given (surrounding whitespace stripped; None or "" clears)."""
        with self._lock:
            settings = self._loaded()
            codex = settings.codex
            if path is not _UNCHANGED:
                codex = replace(codex, path=_clean_text(path))
            if model is not _UNCHANGED:
                codex = replace(codex, model=_clean_text(model))
            self._save(replace(settings, codex=codex))
            return codex
