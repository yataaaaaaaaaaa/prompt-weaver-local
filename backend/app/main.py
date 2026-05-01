from __future__ import annotations

import asyncio
import logging
import os
import signal
import threading
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware

from diffusion_lora_runtime import (
    AdapterLoadError,
    DiffusionGenerator,
    GenerationCancelled,
    KSampleConfig,
    LoRASpec as RuntimeLoRASpec,
    PromptEmbeddingResolutionError,
    PromptLoRAResolutionError,
)
from .schemas import (
    AppState,
    BootstrapResponse,
    GenerateRequest,
    GenerateResponse,
    HealthResponse,
    LibraryState,
    LoRASpec,
    OutputRecord,
    OutputSummary,
    ProgressEvent,
)
from .settings import get_paths
from .storage import DEFAULT_LIBRARY, DEFAULT_STATE, Storage


class ProgressBroker:
    def __init__(self) -> None:
        self._connections: set[WebSocket] = set()
        self._loop: asyncio.AbstractEventLoop | None = None
        self._current = ProgressEvent(stage="idle", message="Idle")
        self._shutting_down = False

    async def connect(self, websocket: WebSocket) -> bool:
        await websocket.accept()
        self._loop = asyncio.get_running_loop()
        if self._shutting_down:
            await self._close_quietly(websocket)
            return False
        self._connections.add(websocket)
        try:
            await websocket.send_json(self._current.model_dump(mode="json"))
        except Exception:
            self._connections.discard(websocket)
            await self._close_quietly(websocket)
            return False
        return True

    async def disconnect(self, websocket: WebSocket) -> None:
        self._connections.discard(websocket)

    async def _close_quietly(self, websocket: WebSocket) -> None:
        try:
            await websocket.close()
        except Exception:
            pass

    async def _broadcast(self, payload: dict[str, Any]) -> None:
        dead: list[WebSocket] = []
        for websocket in list(self._connections):
            try:
                await websocket.send_json(payload)
            except Exception:
                dead.append(websocket)
        for websocket in dead:
            self._connections.discard(websocket)
            await self._close_quietly(websocket)

    async def shutdown(self) -> None:
        self._shutting_down = True
        sockets = list(self._connections)
        self._connections.clear()
        for websocket in sockets:
            await self._close_quietly(websocket)

    def publish(self, event: ProgressEvent) -> None:
        self._current = event
        if self._shutting_down or not self._connections or self._loop is None:
            return
        asyncio.run_coroutine_threadsafe(
            self._broadcast(event.model_dump(mode="json")), self._loop
        )


app = FastAPI(title="Prompt Weaver Local")
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

storage = Storage()
runtime = DiffusionGenerator()
progress = ProgressBroker()
logger = logging.getLogger(__name__)
_previous_signal_handlers: dict[int, Any] = {}
_signal_interrupt_count = 0
_signal_interrupt_lock = threading.Lock()


def _cancel_current_generation() -> None:
    # DiffusionGenerator exposes a small generate/unload API. Prompt Weaver
    # still has a UI cancel button, so use the shared generator runtime
    # cancellation hook when available without keeping a local runtime copy.
    generator_runtime = getattr(runtime, "runtime", None)
    cancel = getattr(generator_runtime, "cancel_current_generation", None)
    if callable(cancel):
        cancel()


def _install_cancel_signal_handlers() -> None:
    for signum in (signal.SIGINT, signal.SIGTERM):
        try:
            previous = signal.getsignal(signum)
        except Exception:
            continue

        def handler(
            received_signum: int, frame: Any, _previous: Any = previous
        ) -> None:
            global _signal_interrupt_count
            _cancel_current_generation()
            try:
                progress.publish(
                    ProgressEvent(
                        stage="error", message="Cancelling current generation"
                    )
                )
            except Exception:
                pass
            with _signal_interrupt_lock:
                _signal_interrupt_count += 1
                interrupt_count = _signal_interrupt_count
            if interrupt_count >= 2:
                os._exit(130)
            if callable(_previous):
                _previous(received_signum, frame)

        try:
            signal.signal(signum, handler)
            _previous_signal_handlers[signum] = previous
        except Exception:
            continue


def _restore_cancel_signal_handlers() -> None:
    for signum, previous in list(_previous_signal_handlers.items()):
        try:
            signal.signal(signum, previous)
        except Exception:
            pass
    _previous_signal_handlers.clear()


@app.on_event("startup")
async def on_startup() -> None:
    _install_cancel_signal_handlers()


@app.on_event("shutdown")
async def on_shutdown() -> None:
    _cancel_current_generation()
    runtime.unload()
    await progress.shutdown()
    _restore_cancel_signal_handlers()


@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse()


@app.websocket("/ws/progress")
async def progress_ws(websocket: WebSocket) -> None:
    connected = await progress.connect(websocket)
    if not connected:
        return
    try:
        while True:
            try:
                await websocket.receive()
            except (WebSocketDisconnect, RuntimeError):
                break
    finally:
        await progress.disconnect(websocket)


@app.post("/api/generate/cancel")
def cancel_generate() -> dict[str, Any]:
    _cancel_current_generation()
    progress.publish(
        ProgressEvent(stage="error", message="Cancelling current generation")
    )
    return {"ok": True}


def _default_state() -> AppState:
    return AppState.model_validate(DEFAULT_STATE)


def _default_library() -> LibraryState:
    return LibraryState.model_validate(DEFAULT_LIBRARY)


@app.get("/api/bootstrap", response_model=BootstrapResponse)
def bootstrap() -> BootstrapResponse:
    state = storage.load_state()
    library = storage.load_library()
    outputs = storage.list_outputs()

    current_output = None
    if state.last_output_id:
        try:
            current_output = storage.load_output(state.last_output_id)
        except FileNotFoundError:
            current_output = None
    if current_output is None:
        current_output = storage.latest_output()

    return BootstrapResponse(
        state=state,
        library=library,
        data_dir=str(get_paths().root),
        outputs=outputs,
        current_output=current_output,
    )


@app.get("/api/outputs", response_model=list[OutputSummary])
def list_outputs() -> list[OutputSummary]:
    return storage.list_outputs()


@app.get("/api/outputs/{output_id}", response_model=OutputRecord)
def get_output(output_id: str) -> OutputRecord:
    try:
        return storage.load_output(output_id)
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=404, detail=f"Unknown output '{output_id}'."
        ) from exc


@app.post("/api/outputs/{output_id}/trash")
def trash_output(output_id: str) -> dict[str, Any]:
    storage.delete_output(output_id)
    return {"ok": True}


@app.post("/api/trash/{output_id}/restore")
def restore_output(output_id: str) -> dict[str, Any]:
    storage.restore_output(output_id)
    return {"ok": True}


@app.post("/api/generate", response_model=GenerateResponse)
def generate(request: GenerateRequest) -> GenerateResponse:
    model = request.model
    selections = request.selections
    requested_lora_ids = [spec.id for spec in request.loras]

    runtime_loras = [
        RuntimeLoRASpec(id=spec.id, name=spec.name, path=spec.path, weight=1.0)
        for spec in request.loras
    ]
    ksample = KSampleConfig(
        width=request.width,
        height=request.height,
        steps=request.steps,
        cfg=request.guidance_scale,
        seed=request.seed,
    )

    preflight_message = (
        f"[Prompt Weaver Local] Generation preflight\n"
        f"  prompt={request.prompt!r}\n"
        f"  negative_prompt={request.negative_prompt!r}\n"
        f"  selected_loras={requested_lora_ids}\n"
        f"  model_path={model.path!r}\n"
        f"  ksample={ksample!r}"
    )
    print(preflight_message, flush=True)
    logger.info(preflight_message)

    try:
        progress.publish(
            ProgressEvent(
                stage="loading_model",
                message=f"Loading model and LoRAs for {model.name}",
            )
        )
        result = runtime.generate(
            prompt=request.prompt,
            negative_prompt=request.negative_prompt,
            model_path=model.path,
            model_id=model.id,
            model_name=model.name,
            loras=runtime_loras,
            ksample=ksample,
            torch_dtype=model.torch_dtype,
            prompt_lora_dir=storage.paths.prompt_lora_dir,
            prompt_embedding_dir=storage.paths.prompt_embedding_dir,
            progress_callback=lambda current, total: progress.publish(
                ProgressEvent(
                    stage="sampling",
                    message=f"Sampling step {current}/{total}",
                    current_step=current,
                    total_steps=total,
                )
            ),
        )
    except (
        RuntimeError,
        ValueError,
        AdapterLoadError,
        PromptLoRAResolutionError,
        PromptEmbeddingResolutionError,
    ) as exc:
        progress.publish(ProgressEvent(stage="error", message=str(exc)))
        raise HTTPException(status_code=409, detail=str(exc)) from exc
    except GenerationCancelled as exc:
        progress.publish(ProgressEvent(stage="idle", message=str(exc)))
        raise HTTPException(status_code=409, detail=str(exc)) from exc

    prompt = result.prompt
    negative_prompt = result.negative_prompt
    image = result.image
    seed = result.seed

    progress.publish(ProgressEvent(stage="saving", message="Saving output"))
    output_id = storage.next_output_id()
    output_record = storage.save_output(
        image=image,
        metadata={
            "output_id": output_id,
            "generated_at": storage.utcnow_iso(),
            "prompt": prompt,
            "negative_prompt": negative_prompt,
            "seed": seed,
            "prompt_seed": request.prompt_seed,
            "image_seed": seed,
            "width": request.width,
            "height": request.height,
            "steps": request.steps,
            "guidance_scale": request.guidance_scale,
            "model_id": model.id,
            "active_lora_ids": requested_lora_ids,
            "selections": [
                selection.model_dump(mode="json") for selection in selections
            ],
        },
    )

    progress.publish(
        ProgressEvent(
            stage="complete",
            message="Complete",
            current_step=request.steps,
            total_steps=request.steps,
        )
    )
    return GenerateResponse.model_validate(output_record.model_dump(mode="json"))
