"""Generation benchmark on the real GPU with real model files (never run by the test suite).

Runs a fixed sequence of generations and reports, for each one:

- wall: the whole call (runtime) or HTTP request (http);
- setup: call -> first progress event (model load, LoRA / IP-Adapter changes, textual inversions, prompt encoding);
- step1: the first denoising step (warm-up);
- it/s: sampling speed over steps 2..N (the steady state);
- finish: last step -> result (VAE decode, offload moves; http: saving the output too).

Targets:

- ``runtime``: diffusion_lora_runtime.DiffusionGenerator in this process (no backend, no frontend);
- ``http``: POST /api/generate of a running backend; the step times come from its progress WebSocket (/ws/tasks, or
  /ws/progress for backends older than the task hub).

The default sequence (``--repeat`` sets N):

  cold          first generation, no LoRA (loads the model; http: also imports torch on the first request)
  base x N      no LoRA, warm
  loras x N     every --lora (the first one adds them, the others repeat the same set)
  weight        same set, the first LoRA's weight changed
  set           another set: the last --lora removed (or replaced by --alt-lora)
  none          no LoRA again
  base-after x N  no LoRA, after LoRAs were used (adapter leftovers would show here)

Usage (from backend/; nothing is written outside --json and the backend's own data dir):

  uv run python scripts/bench_generation.py runtime --model <checkpoint> --lora <file>[=weight] ... [--json out.json]
  uv run python scripts/bench_generation.py http --url http://127.0.0.1:8000 --model <checkpoint> --lora ...

Options: --width/--height/--steps/--cfg/--seed (defaults 768x1344, 30 steps, CFG 3, seed 1234), --prompt/--negative
(inline <lora:name:weight> tags and embedding:name work as in the app), --repeat N, --sequence to pick scenarios
(e.g. "cold,base,base,base"; "loras" first makes the cold generation load the LoRAs too), --gpu to sample GPU
utilization, peak VRAM, peak shared GPU memory (VRAM spilled into system RAM) and the lowest available RAM per
generation (runtime: also torch's allocated/reserved peaks), --probe (http) for the worst /api/health answer time
during each generation (how long the backend made the UI's other requests wait).
The script only uses the public generate API and stdlib HTTP, so it also measures older runtime and backend versions
(run it with their interpreter). Run one GPU process at a time: stop any backend before a runtime run, and vice versa.
"""

from __future__ import annotations

import argparse
import json
import re
import statistics
import subprocess
import sys
import threading
import time
import urllib.request
from dataclasses import asdict, dataclass, field
from pathlib import Path
from typing import Any, Callable

DEFAULT_PROMPT = "1girl, solo, upper body, looking at viewer, smile, outdoors, day, masterpiece, best quality"
DEFAULT_NEGATIVE = "worst quality, low quality, bad anatomy, watermark"
DEFAULT_MODELS_ROOT = Path(r"D:\Anything\ComfyUI\ComfyUI\models")


# ---------------------------------------------------------------------------
# Scenarios
# ---------------------------------------------------------------------------


@dataclass(frozen=True)
class LoraArg:
    path: Path
    weight: float

    @property
    def id(self) -> str:
        return re.sub(r"[^a-z0-9]+", "-", self.path.stem.casefold()).strip("-")


@dataclass(frozen=True)
class Scenario:
    name: str
    loras: tuple[LoraArg, ...]


def parse_lora(text: str) -> LoraArg:
    path, _, weight = text.partition("=")
    resolved = Path(path)
    if not resolved.is_file():
        raise argparse.ArgumentTypeError(f"LoRA file not found: {path}")
    return LoraArg(resolved, float(weight) if weight else 1.0)


def build_sequence(args: argparse.Namespace) -> list[Scenario]:
    loras = tuple(args.lora)
    changed_weight = loras[:1] and (LoraArg(loras[0].path, round(loras[0].weight * 0.5, 4)),) + loras[1:]
    other_set = loras[:-1] + ((args.alt_lora,) if args.alt_lora else ())
    named: dict[str, tuple[LoraArg, ...]] = {
        "cold": (),
        "base": (),
        "loras": loras,
        "weight": tuple(changed_weight),
        "set": other_set,
        "none": (),
        "base-after": (),
    }
    if args.sequence:
        names = [name.strip() for name in args.sequence.split(",") if name.strip()]
    else:
        n = args.repeat
        names = ["cold", *["base"] * n]
        if loras:
            names += [*["loras"] * n, "weight", "set", "none", *["base-after"] * n]
    unknown = [name for name in names if name not in named]
    if unknown:
        raise SystemExit(f"Unknown scenario(s) {unknown}; known: {sorted(named)}")
    if not loras and any(name in ("loras", "weight", "set") for name in names):
        raise SystemExit("Scenarios loras/weight/set need at least one --lora.")
    return [Scenario(name, named[name]) for name in names]


# ---------------------------------------------------------------------------
# Measurements
# ---------------------------------------------------------------------------


@dataclass
class Measurement:
    scenario: str
    loras: list[str]
    wall_s: float
    setup_s: float | None = None
    step1_s: float | None = None
    its: float | None = None
    finish_s: float | None = None
    gpu_util_pct: float | None = None
    vram_peak_mib: float | None = None
    shared_gpu_peak_mib: float | None = None
    ram_available_min_mib: float | None = None
    loop_lag_max_s: float | None = None
    error: str | None = None
    extra: dict[str, Any] = field(default_factory=dict)


def summarize_steps(start: float, end: float, step_times: dict[int, float], total: int) -> dict[str, float | None]:
    """setup / step1 / it/s / finish from the time of each progress step (0 = before the first step)."""
    t0 = step_times.get(0)
    t1 = step_times.get(1)
    tn = step_times.get(total)
    return {
        "setup_s": None if t0 is None else t0 - start,
        "step1_s": None if t0 is None or t1 is None else t1 - t0,
        "its": None if t1 is None or tn is None or tn <= t1 else (total - 1) / (tn - t1),
        "finish_s": None if tn is None else end - tn,
    }


class GpuSampler:
    """nvidia-smi samples every 200 ms: (time.monotonic(), utilization %, memory used MiB); on Windows also, every
    ~500 ms, the GPU's shared memory usage (system RAM the driver spills VRAM into once the card is full: the
    'whole machine crawls' symptom) and the available system RAM (MiB)."""

    _WINDOWS_COUNTERS = (
        "while ($true) { "
        "$g = Get-CimInstance Win32_PerfFormattedData_GPUPerformanceCounters_GPUAdapterMemory | "
        "Sort-Object DedicatedUsage -Descending | Select-Object -First 1; "
        "$m = Get-CimInstance Win32_PerfFormattedData_PerfOS_Memory; "
        "[Console]::Out.WriteLine(\"$($g.SharedUsage),$($m.AvailableMBytes)\"); [Console]::Out.Flush(); "
        "Start-Sleep -Milliseconds 400 }"
    )

    def __init__(self) -> None:
        self.samples: list[tuple[float, float, float]] = []
        self.system: list[tuple[float, float, float]] = []
        self._processes: list[subprocess.Popen[str]] = []

    def start(self) -> None:
        smi = subprocess.Popen(
            ["nvidia-smi", "--query-gpu=utilization.gpu,memory.used", "--format=csv,noheader,nounits", "-lms", "200"],
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        self._processes.append(smi)
        threading.Thread(target=self._read, args=(smi, self.samples), daemon=True).start()
        if sys.platform == "win32":
            counters = subprocess.Popen(
                ["powershell", "-NoProfile", "-Command", self._WINDOWS_COUNTERS],
                stdout=subprocess.PIPE,
                stderr=subprocess.DEVNULL,
                text=True,
            )
            self._processes.append(counters)
            threading.Thread(target=self._read, args=(counters, self.system), daemon=True).start()

    @staticmethod
    def _read(process: subprocess.Popen[str], into: list[tuple[float, float, float]]) -> None:
        assert process.stdout is not None
        for line in process.stdout:
            try:
                first, second = (float(part) for part in line.strip().split(","))
            except ValueError:
                continue
            into.append((time.monotonic(), first, second))

    def stats_between(self, start: float, end: float, sampling: tuple[float, float] | None) -> dict[str, float | None]:
        """Mean utilization while sampling; peak VRAM used, peak shared GPU memory and minimum available RAM over
        the whole generation."""
        window = [sample for sample in self.samples if start <= sample[0] <= end]
        busy = [util for when, util, _ in window if sampling and sampling[0] <= when <= sampling[1]]
        system = [sample for sample in self.system if start <= sample[0] <= end]
        shared = [value for _, value, _ in system]
        return {
            "gpu_util_pct": statistics.fmean(busy) if busy else None,
            "vram_peak_mib": max((used for _, _, used in window), default=None),
            "shared_gpu_peak_mib": max(shared) / 2**20 if shared else None,
            "ram_available_min_mib": min((available for _, _, available in system), default=None),
        }

    def stop(self) -> None:
        for process in self._processes:
            process.terminate()


# ---------------------------------------------------------------------------
# Targets
# ---------------------------------------------------------------------------


class RuntimeTarget:
    """DiffusionGenerator in this process."""

    def __init__(self, args: argparse.Namespace) -> None:
        from diffusion_lora_runtime import DiffusionGenerator, KSampleConfig, LoRASpec

        self._args = args
        self._KSampleConfig = KSampleConfig
        self._LoRASpec = LoRASpec
        self._generator = DiffusionGenerator()

    def run(self, scenario: Scenario, on_step: Callable[[int, int], None]) -> dict[str, Any]:
        import torch

        args = self._args
        if torch.cuda.is_available():
            torch.cuda.reset_peak_memory_stats()
        result = self._generator.generate(
            prompt=args.prompt,
            negative_prompt=args.negative,
            model_path=str(args.model),
            model_id="bench-model",
            model_name=args.model.stem,
            loras=[self._LoRASpec(id=lora.id, name=lora.path.stem, path=str(lora.path), weight=lora.weight) for lora in scenario.loras],
            ksample=self._KSampleConfig(width=args.width, height=args.height, steps=args.steps, cfg=args.cfg, seed=args.seed),
            torch_dtype="float16",
            prompt_lora_dir=args.models_root / "loras",
            prompt_embedding_dir=args.models_root / "embeddings",
            progress_callback=on_step,
        )
        extra: dict[str, Any] = {"seed": result.seed}
        if torch.cuda.is_available():
            extra["torch_allocated_peak_mib"] = round(torch.cuda.max_memory_allocated() / 2**20)
            extra["torch_reserved_peak_mib"] = round(torch.cuda.max_memory_reserved() / 2**20)
        return extra

    def close(self) -> None:
        self._generator.unload()


class HttpTarget:
    """POST /api/generate of a running backend; step times from its progress WebSocket."""

    def __init__(self, args: argparse.Namespace) -> None:
        self._args = args
        self._url = args.url.rstrip("/")
        self._listeners: list[Callable[[int, int], None]] = []
        self._ws_thread = threading.Thread(target=self._listen, daemon=True)
        self._connected = threading.Event()
        self._ws_thread.start()
        if not self._connected.wait(15):
            raise SystemExit(f"Could not connect to the progress WebSocket of {self._url}")

    def _listen(self) -> None:
        from websockets.sync.client import connect

        ws_base = "ws" + self._url[len("http"):]
        for path in ("/ws/tasks", "/ws/progress"):
            try:
                socket = connect(ws_base + path, open_timeout=5, max_size=None)
            except Exception:
                continue
            self._connected.set()
            with socket:
                for message in socket:
                    event = json.loads(message)
                    if event.get("type", "generation") != "generation":
                        continue
                    if event.get("stage") != "sampling":
                        continue
                    current = event.get("current", event.get("current_step", 0))
                    total = event.get("total", event.get("total_steps", 0))
                    for listener in list(self._listeners):
                        listener(int(current), int(total))
            return

    def run(self, scenario: Scenario, on_step: Callable[[int, int], None]) -> dict[str, Any]:
        args = self._args
        body = {
            "model": {
                "id": "bench-model",
                "name": args.model.stem,
                "path": str(args.model),
                "torch_dtype": "float16",
                "default_width": args.width,
                "default_height": args.height,
            },
            "loras": [
                {"id": lora.id, "name": lora.path.stem, "path": str(lora.path), "weight": lora.weight}
                for lora in scenario.loras
            ],
            "prompt": args.prompt,
            "negative_prompt": args.negative,
            "selections": [],
            "width": args.width,
            "height": args.height,
            "steps": args.steps,
            "guidance_scale": args.cfg,
            "seed": args.seed,
            "prompt_seed": 1,
        }
        request = urllib.request.Request(
            f"{self._url}/api/generate",
            data=json.dumps(body).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        self._listeners.append(on_step)
        try:
            with urllib.request.urlopen(request, timeout=900) as response:
                record = json.loads(response.read())
        finally:
            self._listeners.remove(on_step)
        return {"output_id": record.get("output_id")}

    def close(self) -> None:
        pass


class LatencyProbe:
    """GET <url>/api/health every 100 ms from a thread: the worst answer time shows how long the backend's event loop
    (or the GIL) was blocked, which is how long the UI's other requests (thumbnails, store saves, progress) waited."""

    def __init__(self, url: str) -> None:
        self._url = url.rstrip("/") + "/api/health"
        self.samples: list[tuple[float, float]] = []
        self._stop = threading.Event()
        self._thread = threading.Thread(target=self._run, daemon=True)

    def start(self) -> None:
        self._thread.start()

    def _run(self) -> None:
        while not self._stop.is_set():
            sent = time.monotonic()
            try:
                with urllib.request.urlopen(self._url, timeout=120) as response:
                    response.read()
            except Exception:
                pass
            self.samples.append((sent, time.monotonic() - sent))
            self._stop.wait(0.1)

    def worst_between(self, start: float, end: float) -> float | None:
        values = [latency for sent, latency in self.samples if start <= sent <= end]
        return max(values) if values else None

    def stop(self) -> None:
        self._stop.set()


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def run_sequence(
    target: Any, sequence: list[Scenario], args: argparse.Namespace, gpu: GpuSampler | None, probe: LatencyProbe | None
) -> list[Measurement]:
    results: list[Measurement] = []
    for index, scenario in enumerate(sequence, start=1):
        step_times: dict[int, float] = {}

        def on_step(current: int, total: int, _times: dict[int, float] = step_times) -> None:
            _times.setdefault(current, time.monotonic())

        start = time.monotonic()
        error = None
        extra: dict[str, Any] = {}
        try:
            extra = target.run(scenario, on_step)
        except Exception as exc:  # report and continue: a failing scenario must not hide the others
            error = f"{type(exc).__name__}: {exc}"
        end = time.monotonic()
        stats: dict[str, Any] = summarize_steps(start, end, step_times, args.steps)
        if gpu is not None:
            sampling = (step_times[1], step_times[args.steps]) if 1 in step_times and args.steps in step_times else None
            time.sleep(0.6)  # the last counter samples of this generation
            stats.update(gpu.stats_between(start, end, sampling))
        if probe is not None:
            stats["loop_lag_max_s"] = probe.worst_between(start, end)
        measurement = Measurement(
            scenario=scenario.name,
            loras=[f"{lora.path.stem}={lora.weight:g}" for lora in scenario.loras],
            wall_s=end - start,
            error=error,
            extra=extra,
            **stats,
        )
        results.append(measurement)
        print(format_row(index, measurement), flush=True)
    return results


def _fmt(value: float | None, pattern: str) -> str:
    return "-" if value is None else pattern.format(value)


def format_row(index: int, m: Measurement) -> str:
    loras = ",".join(m.loras) or "-"
    text = (
        f"{index:>2} {m.scenario:<10} wall {_fmt(m.wall_s, '{:6.2f}')}s  setup {_fmt(m.setup_s, '{:6.2f}')}s  "
        f"step1 {_fmt(m.step1_s, '{:5.2f}')}s  {_fmt(m.its, '{:5.3f}')} it/s  finish {_fmt(m.finish_s, '{:5.2f}')}s"
    )
    if m.gpu_util_pct is not None:
        text += f"  gpu {m.gpu_util_pct:4.0f}%"
    if m.vram_peak_mib is not None:
        text += f"  vram {m.vram_peak_mib:5.0f}MiB"
    if "torch_allocated_peak_mib" in m.extra:
        text += f" (torch {m.extra['torch_allocated_peak_mib']}/{m.extra['torch_reserved_peak_mib']})"
    if m.shared_gpu_peak_mib is not None:
        text += f"  shared {m.shared_gpu_peak_mib:5.0f}MiB"
    if m.ram_available_min_mib is not None:
        text += f"  ram-free {m.ram_available_min_mib:5.0f}MiB"
    if m.loop_lag_max_s is not None:
        text += f"  lag {m.loop_lag_max_s:5.2f}s"
    text += f"  [{loras}]"
    if m.error:
        text += f"  ERROR {m.error}"
    return text


def print_summary(results: list[Measurement]) -> None:
    print("\nscenario    n  wall(med)  setup(med)  it/s(med)  finish(med)")
    for name in dict.fromkeys(m.scenario for m in results):
        group = [m for m in results if m.scenario == name and m.error is None]
        if not group:
            continue

        def med(values: list[float | None]) -> float | None:
            present = [value for value in values if value is not None]
            return statistics.median(present) if present else None

        print(
            f"{name:<10} {len(group):>2}  {_fmt(med([m.wall_s for m in group]), '{:8.2f}')}s"
            f"  {_fmt(med([m.setup_s for m in group]), '{:8.2f}')}s  {_fmt(med([m.its for m in group]), '{:8.3f}')}"
            f"  {_fmt(med([m.finish_s for m in group]), '{:9.2f}')}s"
        )


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("target", choices=("runtime", "http"))
    parser.add_argument("--url", default="http://127.0.0.1:8000", help="backend URL (http target)")
    parser.add_argument("--model", type=Path, required=True, help="checkpoint file or Diffusers folder")
    parser.add_argument("--lora", type=parse_lora, action="append", default=[], help="LoRA file[=weight] (repeatable)")
    parser.add_argument("--alt-lora", type=parse_lora, default=None, help="LoRA that replaces the last one in 'set'")
    parser.add_argument("--models-root", type=Path, default=DEFAULT_MODELS_ROOT, help="for inline LoRAs and embeddings")
    parser.add_argument("--prompt", default=DEFAULT_PROMPT)
    parser.add_argument("--negative", default=DEFAULT_NEGATIVE)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=1344)
    parser.add_argument("--steps", type=int, default=30)
    parser.add_argument("--cfg", type=float, default=3.0)
    parser.add_argument("--seed", type=int, default=1234)
    parser.add_argument("--repeat", type=int, default=3, help="N of the repeated scenarios")
    parser.add_argument("--sequence", default="", help="comma-separated scenario names instead of the default sequence")
    parser.add_argument("--gpu", action="store_true", help="sample GPU utilization, VRAM, shared GPU memory, free RAM")
    parser.add_argument("--probe", action="store_true", help="http: worst /api/health answer time during each generation")
    parser.add_argument("--label", default="", help="free text stored in the JSON")
    parser.add_argument("--json", type=Path, default=None, help="write the measurements to this file")
    args = parser.parse_args(argv)
    if not args.model.exists():
        parser.error(f"model not found: {args.model}")
    return args


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    sequence = build_sequence(args)
    gpu = GpuSampler() if args.gpu else None
    if gpu is not None:
        gpu.start()
    created = time.monotonic()
    target = RuntimeTarget(args) if args.target == "runtime" else HttpTarget(args)
    print(f"target {args.target} ready in {time.monotonic() - created:.1f}s; {len(sequence)} generations", flush=True)
    probe = LatencyProbe(args.url) if args.probe and args.target == "http" else None
    if probe is not None:
        probe.start()
    try:
        results = run_sequence(target, sequence, args, gpu, probe)
    finally:
        target.close()
        if gpu is not None:
            gpu.stop()
        if probe is not None:
            probe.stop()
    print_summary(results)
    if args.json is not None:
        args.json.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "label": args.label,
            "target": args.target,
            "argv": sys.argv[1:],
            "settings": {"width": args.width, "height": args.height, "steps": args.steps, "cfg": args.cfg},
            "results": [asdict(m) for m in results],
        }
        args.json.write_text(json.dumps(payload, indent=2, default=str), encoding="utf-8")
    return 1 if any(m.error for m in results) else 0


if __name__ == "__main__":
    raise SystemExit(main())
