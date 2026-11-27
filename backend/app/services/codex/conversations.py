"""The co-writer's conversations: which conversation each story has, the Codex thread behind it, and its entries.

THE rules:
- a story has at most one conversation; New conversation gives it a fresh one (the old one stays with the other
  stories it has, if any);
- while no story is selected the user talks in the draft conversation;
- a story created by the co-writer (create_story) joins the conversation that created it, so the conversation goes
  on, shown with the new story; a draft conversation that created a story becomes that story's;
- the transcript itself lives in Codex (its thread history); the entries here are its live copy, rebuilt from the
  thread history after a restart.

Storage: <data dir>/codex/conversations.json (AppPaths.codex_conversations_file), format version 1, the conversations
that have a Codex thread (an empty one is not saved):
    {"version": 1, "conversations": [{"id": "cnv-...", "thread_id": "...", "story_ids": ["sty-..."], "draft": false}]}
It is an index into Codex's own history (derived, safe to delete: the stories only lose their conversations); an
unreadable file reads as empty. Thread-safe.
"""

from __future__ import annotations

import logging
import re
import threading
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

from ...schemas import CodexConversation, CodexEntry
from ..ids import new_id
from ..json_files import read_resilient_json, write_json_atomic

logger = logging.getLogger(__name__)

CONVERSATIONS_FORMAT_VERSION = 1
CONVERSATION_ID_PREFIX = "cnv-"
_CONVERSATION_ID = re.compile(r"^cnv-[0-9a-f]{12}$")
_STORY_ID = re.compile(r"^sty-[0-9a-f]{12}$")


@dataclass
class Conversation:
    id: str
    thread_id: str | None = None
    story_ids: list[str] = field(default_factory=list)
    draft: bool = False
    entries: list[CodexEntry] = field(default_factory=list)
    # The entries are those of the thread (False: a saved conversation whose history was not read yet).
    history_loaded: bool = True
    running: bool = False
    # Every visible change bumps it (changed()): the frontend drops snapshots and events older than what it shows.
    revision: int = 0

    def changed(self) -> int:
        self.revision += 1
        return self.revision

    def snapshot(self) -> CodexConversation:
        return CodexConversation(
            id=self.id,
            story_ids=list(self.story_ids),
            draft=self.draft,
            entries=list(self.entries),
            running=self.running,
            revision=self.revision,
        )

    def entry_index(self, entry_id: str) -> int | None:
        return next((index for index, entry in enumerate(self.entries) if entry.id == entry_id), None)

    def upsert(self, entry: CodexEntry) -> int:
        """Adds the entry or replaces the one of its id; answers the new revision."""
        index = self.entry_index(entry.id)
        if index is None:
            self.entries.append(entry)
        else:
            self.entries[index] = entry
        return self.changed()


def _parse(payload: Any) -> list[Conversation]:
    if not isinstance(payload, dict) or payload.get("version") != CONVERSATIONS_FORMAT_VERSION:
        return []
    items = payload.get("conversations")
    conversations: list[Conversation] = []
    for item in items if isinstance(items, list) else []:
        if not isinstance(item, dict):
            continue
        conversation_id, thread_id, story_ids = item.get("id"), item.get("thread_id"), item.get("story_ids")
        if not (isinstance(conversation_id, str) and _CONVERSATION_ID.match(conversation_id) and isinstance(thread_id, str) and thread_id):
            continue
        conversations.append(
            Conversation(
                id=conversation_id,
                thread_id=thread_id,
                story_ids=[story for story in story_ids if isinstance(story, str) and _STORY_ID.match(story)]
                if isinstance(story_ids, list)
                else [],
                draft=item.get("draft") is True,
                history_loaded=False,
            )
        )
    return conversations


class ConversationRegistry:
    def __init__(self, path: Path) -> None:
        self._path = path
        self._lock = threading.RLock()
        self._conversations: list[Conversation] | None = None

    @property
    def lock(self) -> threading.RLock:
        """Held while a conversation's state changes (the service takes it around its own updates too)."""
        return self._lock

    def _loaded(self) -> list[Conversation]:
        if self._conversations is None:
            try:
                payload = read_resilient_json(self._path)
            except OSError:
                payload = None
            self._conversations = _parse(payload)
        return self._conversations

    def save(self) -> None:
        with self._lock:
            payload = {
                "version": CONVERSATIONS_FORMAT_VERSION,
                "conversations": [
                    {"id": item.id, "thread_id": item.thread_id, "story_ids": item.story_ids, "draft": item.draft}
                    for item in self._loaded()
                    if item.thread_id and (item.story_ids or item.draft)
                ],
            }
            try:
                write_json_atomic(self._path, payload)
            except OSError:
                logger.warning("The co-writer's conversations could not be saved", exc_info=True)

    def get(self, conversation_id: str) -> Conversation | None:
        with self._lock:
            return next((item for item in self._loaded() if item.id == conversation_id), None)

    def by_thread(self, thread_id: str) -> Conversation | None:
        with self._lock:
            return next((item for item in self._loaded() if item.thread_id == thread_id), None)

    def running(self) -> Conversation | None:
        with self._lock:
            return next((item for item in self._loaded() if item.running), None)

    def all(self) -> list[Conversation]:
        with self._lock:
            return list(self._loaded())

    def for_story(self, story_id: str | None) -> Conversation:
        """The conversation of a story (None: the draft), created empty when it has none."""
        with self._lock:
            conversations = self._loaded()
            found = next(
                (item for item in conversations if (story_id in item.story_ids if story_id else item.draft)),
                None,
            )
            if found is None:
                found = Conversation(
                    id=new_id(CONVERSATION_ID_PREFIX), story_ids=[story_id] if story_id else [], draft=story_id is None
                )
                conversations.append(found)
            return found

    def reset(self, story_id: str | None) -> tuple[Conversation | None, Conversation]:
        """New conversation: the story (None: the draft) leaves its conversation (answered first, None when it had
        none) and gets an empty one (answered second)."""
        with self._lock:
            conversations = self._loaded()
            previous = next(
                (item for item in conversations if (story_id in item.story_ids if story_id else item.draft)),
                None,
            )
            if previous is not None:
                if story_id:
                    previous.story_ids.remove(story_id)
                else:
                    previous.draft = False
                previous.changed()
                if not previous.story_ids and not previous.draft and not previous.running:
                    conversations.remove(previous)
            fresh = Conversation(id=new_id(CONVERSATION_ID_PREFIX), story_ids=[story_id] if story_id else [], draft=story_id is None)
            conversations.append(fresh)
            self.save()
            return previous, fresh

    def adopt(self, conversation: Conversation, story_id: str) -> bool:
        """A story created in `conversation` joins it (a draft becomes that story's conversation). False when it
        already belonged to it."""
        with self._lock:
            if story_id in conversation.story_ids:
                return False
            conversations = self._loaded()
            for other in list(conversations):
                if other is not conversation and story_id in other.story_ids:
                    other.story_ids.remove(story_id)
                    other.changed()
                    if not (other.story_ids or other.draft or other.thread_id or other.running):
                        conversations.remove(other)  # the empty conversation the story was given meanwhile
            conversation.story_ids.append(story_id)
            conversation.draft = False
            conversation.changed()
            self.save()
            return True

    def forget_stories(self, existing: set[str]) -> None:
        """Drops the stories that no longer exist from every conversation."""
        with self._lock:
            changed = False
            for item in self._loaded():
                kept = [story for story in item.story_ids if story in existing]
                if kept != item.story_ids:
                    item.story_ids = kept
                    item.changed()
                    changed = True
            if changed:
                self.save()
