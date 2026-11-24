"""Backend-only settings stored in <data dir>/backend_settings.json (AppPaths.settings_file).

Today: provider API tokens (e.g. the optional Civitai token some downloads require). Rules:
- a token is stored once, here; providers read it with get_token(provider_id) when they build a request;
- its value never leaves the backend: the API only reports token_set (has_token), it is never logged,
  never put in an exception message, and never included in a repr;
- reads are crash-resilient and writes atomic (services/json_files.py); a missing or unreadable file means
  "no settings" (it is rewritten on the next set_token);
- thread-safe (routes run in the threadpool).

File format (version 1): {"version": 1, "provider_tokens": {"civitai": "<token>"}}
"""

from __future__ import annotations

import threading
from pathlib import Path
from typing import Any

from .json_files import read_resilient_json, write_json_atomic

SETTINGS_FORMAT_VERSION = 1


def _parse_tokens(payload: Any) -> dict[str, str]:
    """Provider tokens of a settings file payload; anything that is not a valid version 1 file reads as empty."""
    if not isinstance(payload, dict) or payload.get("version") != SETTINGS_FORMAT_VERSION:
        return {}
    tokens = payload.get("provider_tokens")
    if not isinstance(tokens, dict):
        return {}
    return {
        provider_id: token.strip()
        for provider_id, token in tokens.items()
        if isinstance(provider_id, str) and isinstance(token, str) and token.strip()
    }


class BackendSettingsStore:
    def __init__(self, settings_file: Path) -> None:
        self._settings_file = settings_file
        self._lock = threading.Lock()
        # Loaded lazily from the file on first use (construction performs no IO).
        self._tokens: dict[str, str] | None = None

    def __repr__(self) -> str:
        # Never the token values.
        return f"{type(self).__name__}(settings_file={str(self._settings_file)!r})"

    def _loaded_tokens(self) -> dict[str, str]:
        """The tokens (caller holds the lock)."""
        if self._tokens is None:
            try:
                payload = read_resilient_json(self._settings_file)
            except OSError:
                payload = None
            self._tokens = _parse_tokens(payload)
        return self._tokens

    def get_token(self, provider_id: str) -> str | None:
        """The stored token of `provider_id` (None when unset)."""
        with self._lock:
            return self._loaded_tokens().get(provider_id)

    def has_token(self, provider_id: str) -> bool:
        return self.get_token(provider_id) is not None

    def set_token(self, provider_id: str, token: str | None) -> None:
        """Stores the token (surrounding whitespace stripped); None or an empty string removes it."""
        value = (token or "").strip()
        with self._lock:
            tokens = dict(self._loaded_tokens())
            if value:
                tokens[provider_id] = value
            else:
                tokens.pop(provider_id, None)
            write_json_atomic(self._settings_file, {"version": SETTINGS_FORMAT_VERSION, "provider_tokens": tokens})
            self._tokens = tokens
