"""The co-writer (services/codex/): the status of the user's Codex (found, signed in, its models), its settings, the
conversations of the stories, the user's messages, Stop, and the results of the tool calls the frontend ran. The answers
stream over /ws/tasks (CodexEvent). Codex itself reaches the app's tools through the co-writer's own MCP server on
127.0.0.1 (services/codex/mcp_server.py), not through these routes.

Route signatures are the API contract mirrored in backend/openapi.json and frontend/src/api/schema.gen.ts: change them
only together with `npm run gen:api`.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from typing import Annotated

from fastapi import APIRouter, HTTPException, Path, Query

from ..dependencies import ServicesDep
from ..schemas import (
    CONVERSATION_ID_PATTERN,
    STORY_ID_PATTERN,
    CodexConversation,
    CodexConversationReset,
    CodexSettingsUpdate,
    CodexStatus,
    CodexToolResult,
    CodexTurnRequest,
    OkResponse,
)
from ..services.codex.service import CodexBusy, CodexUnavailable, ConversationNotFound
from ..services.stories import StoriesFileError, StoryNotFound

router = APIRouter(prefix="/api/codex", tags=["codex"])

_CONFLICT = {409: {"description": "Codex cannot work now (not found, not signed in) or is still answering"}}
_NOT_FOUND = {404: {"description": "Unknown story, conversation or tool call"}}


@contextmanager
def codex_http_errors() -> Iterator[None]:
    try:
        yield
    except (StoryNotFound, ConversationNotFound) as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except (CodexUnavailable, CodexBusy) as exc:
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except StoriesFileError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc


@router.get("/status", response_model=CodexStatus)
def get_status(services: ServicesDep, refresh: bool = False) -> CodexStatus:
    """Whether the co-writer can work. Looks for Codex and asks it about its login on the first call; `refresh`
    (Retry) looks again."""
    return services.codex.status(refresh=refresh)


@router.put("/settings", response_model=CodexStatus, responses=_CONFLICT)
def update_settings(update: CodexSettingsUpdate, services: ServicesDep) -> CodexStatus:
    """The Codex path (null: auto-detect; Codex is looked for again) and the model (null: the user's default)."""
    with codex_http_errors():
        return services.codex.update_settings(update)


@router.get("/conversation", response_model=CodexConversation, responses=_NOT_FOUND)
def get_conversation(
    services: ServicesDep, story_id: Annotated[str | None, Query(pattern=STORY_ID_PATTERN)] = None
) -> CodexConversation:
    """The conversation of a story (without story_id: the draft conversation); its history is read from Codex once."""
    with codex_http_errors():
        return services.codex.conversation(story_id)


@router.post("/conversation/reset", response_model=CodexConversation, responses={**_NOT_FOUND, **_CONFLICT})
def reset_conversation(request: CodexConversationReset, services: ServicesDep) -> CodexConversation:
    """New conversation: the story (or the draft) gets an empty conversation."""
    with codex_http_errors():
        return services.codex.reset(request.story_id)


@router.post("/turns", response_model=CodexConversation, responses={**_NOT_FOUND, **_CONFLICT})
def send_message(request: CodexTurnRequest, services: ServicesDep) -> CodexConversation:
    """Sends the user's message (starting Codex when needed); answers the conversation with the message, the answer
    streams over /ws/tasks. A failure to reach Codex shows as an error entry of the conversation."""
    with codex_http_errors():
        return services.codex.send(request)


@router.post(
    "/conversations/{conversation_id}/interrupt", response_model=CodexConversation, responses=_NOT_FOUND
)
def interrupt(
    conversation_id: Annotated[str, Path(pattern=CONVERSATION_ID_PATTERN)], services: ServicesDep
) -> CodexConversation:
    """Stop: interrupts the running answer; its tool calls are abandoned (the window stops a running generation)."""
    with codex_http_errors():
        return services.codex.interrupt(conversation_id)


@router.post("/tool-calls/{call_id}/result", response_model=OkResponse, responses=_NOT_FOUND)
def tool_call_result(
    call_id: Annotated[str, Path(pattern=r"^call-[0-9a-f]{32}$")], result: CodexToolResult, services: ServicesDep
) -> OkResponse:
    """The result of a tool call the frontend ran; 404 when the call is unknown or already over (stopped, timed out)."""
    if not services.codex.resolve_tool_call(call_id, result):
        raise HTTPException(status_code=404, detail="Unknown or finished tool call")
    return OkResponse()
