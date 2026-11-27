"""Ids and timestamps of backend-owned records (characters, character images, stories, scenes): "<prefix><12 hex>"
(the patterns live in app/schemas.py) and timezone-aware UTC times."""

from __future__ import annotations

import uuid
from datetime import UTC, datetime

ID_HEX_LENGTH = 12


def new_id(prefix: str) -> str:
    """A new random id: `prefix` followed by ID_HEX_LENGTH lowercase hex digits."""
    return f"{prefix}{uuid.uuid4().hex[:ID_HEX_LENGTH]}"


def utc_now() -> datetime:
    return datetime.now(UTC)
