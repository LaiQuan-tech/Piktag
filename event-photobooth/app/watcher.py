"""File-system watcher: detects new photos in inbox/, runs the full pipeline.

Design notes:
- Camera tools (Capture One, Imaging Edge, EOS Utility, …) write large JPEGs
  progressively. on_created fires when the file appears, but the bytes may
  still be streaming. We poll size until it's stable for ~500ms before
  attempting to open — otherwise Pillow gets a truncated image and throws.
- Originals are MOVED to processed/{CODE}_{name} after success so the next
  on_created event doesn't fire on the same file.
- Failures move the original to errors/ and log; the watcher keeps running.
"""

from __future__ import annotations

import concurrent.futures
import subprocess
import sys
import threading
import time
import traceback
from pathlib import Path
from typing import Callable, Optional

from watchdog.events import FileSystemEvent, FileSystemEventHandler

from .code_gen import display, new_code
from .printer import Printer
from .processor import Processor
from .qr_gen import make_qr, url_for
from .uploader import SupabaseUploader

IMAGE_EXTS = {".jpg", ".jpeg", ".png", ".heic", ".heif", ".webp"}

# How long to wait for camera/tether software to finish writing a file.
# We poll size every STABLE_POLL_SEC; consider stable after STABLE_CONFIRMS
# consecutive matches, give up after MAX_WAIT_SEC.
STABLE_POLL_SEC = 0.25
STABLE_CONFIRMS = 3
MAX_WAIT_SEC = 20

# Hard cap on how long we wait for the thermal printer to finish a receipt.
PRINT_TIMEOUT_SEC = 20


class PrinterWorker:
    """Long-running print_worker.py subprocess with stdin/stdout IPC.

    The old approach spawned a fresh subprocess per print, paying ~1-2s of
    Python startup + module-import cost every time. This class starts the
    worker ONCE and keeps it alive, reducing per-print overhead to just the
    USB enumeration + render + transfer (~0.5-1s vs ~3s).

    If the worker hangs (paper jam, USB wedge) the stdout read times out,
    the process is killed, and the next print restarts it automatically.
    """

    def __init__(self, timeout_sec: int = PRINT_TIMEOUT_SEC):
        self.timeout_sec = timeout_sec
        self._proc: Optional[subprocess.Popen] = None
        self._lock = threading.Lock()
        self._project_root = Path(__file__).resolve().parent.parent
        self._start()

    def _python(self) -> Path:
        p = self._project_root / ".venv" / "bin" / "python"
        return p if p.exists() else Path(sys.executable)

    def _start(self):
        helper = self._project_root / "scripts" / "print_worker.py"
        self._proc = subprocess.Popen(
            [str(self._python()), str(helper)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            text=True,
            bufsize=1,
        )
        # Wait for "READY" line so the first print job doesn't race imports.
        ready_line = [None]
        def _read_ready():
            ready_line[0] = self._proc.stdout.readline().strip()
        t = threading.Thread(target=_read_ready, daemon=True)
        t.start()
        t.join(timeout=15)
        if t.is_alive() or ready_line[0] != "READY":
            self._proc.kill()
            self._proc = None
            raise RuntimeError(
                f"print_worker did not send READY (got {ready_line[0]!r}). "
                "Check printer config / libusb."
            )

    def print_receipt(self, code: str) -> str:
        """Send a code, return 'OK <ms>ms'. Raises on error or timeout."""
        with self._lock:
            if self._proc is None or self._proc.poll() is not None:
                self._start()
            proc = self._proc
            try:
                proc.stdin.write(code + "\n")
                proc.stdin.flush()
                result: list[Optional[str]] = [None]
                def _read():
                    result[0] = proc.stdout.readline().strip()
                t = threading.Thread(target=_read, daemon=True)
                t.start()
                t.join(timeout=self.timeout_sec)
                if t.is_alive():
                    proc.kill()
                    self._proc = None
                    raise TimeoutError(f"print timed out after {self.timeout_sec}s")
                line = result[0]
                if not line or line.startswith("ERR"):
                    raise RuntimeError(line or "empty response from print worker")
                return line
            except TimeoutError:
                raise
            except Exception:
                try:
                    proc.kill()
                except Exception:
                    pass
                self._proc = None
                raise

    def close(self):
        if self._proc is not None:
            try:
                self._proc.stdin.close()
                self._proc.wait(timeout=2)
            except Exception:
                self._proc.kill()
            self._proc = None


class InboxHandler(FileSystemEventHandler):
    def __init__(
        self,
        processor: Processor,
        uploader: Optional[SupabaseUploader],
        printer: Optional[Printer],
        output_root: Path,
        processed_dir: Path,
        errors_dir: Path,
        org: str = "rotary",
        on_ready: Optional[Callable[[str, str, Path], None]] = None,
    ):
        self.processor = processor
        self.uploader = uploader
        self.printer = printer
        self.output_root = output_root
        self.processed_dir = processed_dir
        self.errors_dir = errors_dir
        self.org = org
        self.on_ready = on_ready
        # Persistent print worker — started once, reused for every print.
        # Falls back to None if printer config is missing.
        self._print_worker: Optional[PrinterWorker] = None
        if printer is not None:
            try:
                self._print_worker = PrinterWorker()
                print("  print worker started (persistent subprocess)")
            except Exception as e:
                print(f"  print worker failed to start: {e} — will retry per print")

        # Thread pool: allows bg-remove on photo N+1 to overlap with upload of
        # photo N. max_workers=2 — more would saturate birefnet-portrait on a
        # laptop; the win is CPU/net overlap, not parallelising CPU.
        self._executor = concurrent.futures.ThreadPoolExecutor(
            max_workers=2, thread_name_prefix="photo"
        )

    def on_created(self, event: FileSystemEvent):
        self._handle(Path(str(event.src_path)), is_directory=event.is_directory)

    def on_moved(self, event: FileSystemEvent):
        # macOS Finder drag-drop into a folder fires a Move event, not Create.
        # The destination path is in dest_path on Move events.
        dest = getattr(event, "dest_path", None)
        if dest:
            self._handle(Path(str(dest)), is_directory=event.is_directory)

    def scan_inbox(self, inbox: Path):
        """Pick up any image files already sitting in inbox at startup."""
        for p in sorted(inbox.iterdir()):
            if p.is_file():
                self._handle(p, is_directory=False)

    def _handle(self, path: Path, is_directory: bool):
        if is_directory:
            return
        if path.suffix.lower() not in IMAGE_EXTS:
            return
        if path.name.startswith(".") or path.name.startswith("~"):
            return
        if not path.exists():
            return

        try:
            if not self._wait_stable(path):
                print(f"  {path.name}: timed out waiting for upload to finish")
                self._move_to(path, self.errors_dir)
                return
        except Exception as e:
            print(f"  {path.name}: FAILED waiting — {type(e).__name__}: {e}")
            self._move_to(path, self.errors_dir)
            return

        # Submit to thread pool so the next photo's bg-remove can start while
        # this one is blocked on network upload.
        self._executor.submit(self._process_safe, path)

    def _wait_stable(self, path: Path) -> bool:
        """Return True once file size is stable; False on timeout."""
        deadline = time.time() + MAX_WAIT_SEC
        last = -1
        same = 0
        while time.time() < deadline:
            try:
                size = path.stat().st_size
            except FileNotFoundError:
                # got moved/deleted while we were waiting
                return False
            if size == last and size > 0:
                same += 1
                if same >= STABLE_CONFIRMS:
                    return True
            else:
                same = 0
                last = size
            time.sleep(STABLE_POLL_SEC)
        return False

    def _process(self, path: Path):
        code = new_code()
        display_code = display(code)
        output_dir = self.output_root / code
        url = url_for(code, org=self.org)

        print(f"[{display_code}] {path.name}")

        result = self.processor.process(path, output_dir, code)
        print(
            f"[{display_code}]   processed in {result.total_ms} ms "
            f"(bg={result.bg_remove_ms} ms, compose={result.compose_ms} ms)"
        )

        make_qr(url, output_dir / "qr.png")

        if self.uploader is not None:
            up = self.uploader.upload_set(code, sorted(output_dir.glob("*.jpg"))[:5])
            print(
                f"[{display_code}]   uploaded {len(up.keys)} files, "
                f"{up.bytes_uploaded // 1024} KB in {up.duration_ms} ms"
            )
        else:
            print(f"[{display_code}]   upload skipped (no Supabase config)")

        # Print is the LAST step the guest waits on — do it right before the
        # "done" log so the receipt comes out at the same moment the URL is live.
        no_print_flag = Path.home() / "PhotoBooth" / ".no_print"
        if no_print_flag.exists():
            print(f"[{display_code}]   print skipped (.no_print flag active)")
        elif self._print_worker is not None:
            self._try_print_with_worker(code, display_code)
        elif self.printer is not None:
            # Fallback: worker failed to start — spawn a one-shot subprocess.
            self._try_print_subprocess(code, display_code)
        else:
            print(f"[{display_code}]   print skipped (no printer config)")

        self._move_to(path, self.processed_dir, prefix=code)
        print(f"[{display_code}]   ✓ {url}")

        if self.on_ready is not None:
            self.on_ready(code, url, output_dir)

    def shutdown(self):
        """Drain in-flight jobs and clean up resources. Call on Ctrl+C / SIGTERM."""
        self._executor.shutdown(wait=True)
        if self._print_worker is not None:
            self._print_worker.close()

    def _process_safe(self, path: Path):
        """Thread-pool wrapper: catches all exceptions and routes to errors/."""
        try:
            self._process(path)
        except Exception as e:
            print(f"  {path.name}: FAILED — {type(e).__name__}: {e}")
            traceback.print_exc()
            self._move_to(path, self.errors_dir)

    def _try_print_with_worker(self, code: str, display_code: str):
        """Print via the persistent worker subprocess (fast path — no cold start)."""
        try:
            status = self._print_worker.print_receipt(code)
            print(f"[{display_code}]   printed ({status})")
        except TimeoutError:
            print(
                f"[{display_code}]   print TIMED OUT after {PRINT_TIMEOUT_SEC}s — "
                f"worker killed, will restart next print. "
                f"Reprint: scripts/print_one.py {code}"
            )
        except Exception as e:
            print(f"[{display_code}]   print FAILED: {type(e).__name__}: {e}")

    def _try_print_subprocess(self, code: str, display_code: str):
        """Fallback: one-shot subprocess (slow, ~2s cold start). Used only when
        the persistent worker failed to initialise at startup."""
        project_root = Path(__file__).resolve().parent.parent
        python = project_root / ".venv" / "bin" / "python"
        helper = project_root / "scripts" / "print_one.py"
        if not python.exists():
            python = Path(sys.executable)

        try:
            result = subprocess.run(
                [str(python), str(helper), code],
                timeout=PRINT_TIMEOUT_SEC,
                capture_output=True,
                text=True,
            )
        except subprocess.TimeoutExpired:
            print(
                f"[{display_code}]   print TIMED OUT after {PRINT_TIMEOUT_SEC}s — "
                f"subprocess killed. Reprint: scripts/print_one.py {code}"
            )
            return

        if result.returncode == 0:
            print(f"[{display_code}]   printed ({result.stdout.strip()})")
        else:
            err = (result.stderr or result.stdout).strip().splitlines()
            tail = err[-1] if err else "(no error message)"
            print(f"[{display_code}]   print FAILED rc={result.returncode}: {tail}")

    def _move_to(self, src: Path, dst_dir: Path, prefix: Optional[str] = None):
        if not src.exists():
            return
        dst_dir.mkdir(parents=True, exist_ok=True)
        name = f"{prefix}_{src.name}" if prefix else src.name
        try:
            src.rename(dst_dir / name)
        except FileNotFoundError:
            pass  # already moved — upload succeeded, not an error
        except OSError:
            # cross-device move fallback — copy + unlink
            import shutil
            shutil.copy2(src, dst_dir / name)
            src.unlink(missing_ok=True)
