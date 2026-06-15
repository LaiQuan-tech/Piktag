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

import subprocess
import sys
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
# python-escpos / pyusb don't expose a clean timeout — if the printer is
# beeping (out of paper, cover open, firmware confused), USB writes can
# block indefinitely and stall the whole pipeline. We wrap the print in a
# daemon thread and move on if it hasn't returned in this many seconds.
PRINT_TIMEOUT_SEC = 20


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
            self._process(path)
        except Exception as e:
            print(f"  {path.name}: FAILED — {type(e).__name__}: {e}")
            traceback.print_exc()
            self._move_to(path, self.errors_dir)

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
        # Wrapped in a timeout: a beeping printer (out of paper / cover open) can
        # block USB writes indefinitely and would otherwise stall the entire pipeline.
        no_print_flag = Path.home() / "PhotoBooth" / ".no_print"
        if no_print_flag.exists():
            print(f"[{display_code}]   print skipped (.no_print flag active)")
        elif self.printer is not None:
            self._try_print_with_timeout(code, display_code)
        else:
            print(f"[{display_code}]   print skipped (no printer config)")

        self._move_to(path, self.processed_dir, prefix=code)
        print(f"[{display_code}]   ✓ {url}")

        if self.on_ready is not None:
            self.on_ready(code, url, output_dir)

    def _try_print_with_timeout(self, code: str, display_code: str):
        """Run the print as a subprocess. If it hangs (paper / cover / firmware /
        wedged USB), subprocess.run kills it cleanly via SIGKILL and the OS
        reliably reclaims all USB resources — unlike a Python thread, which
        can't be force-killed and would leak the USB handle every timeout."""
        project_root = Path(__file__).resolve().parent.parent
        python = project_root / ".venv" / "bin" / "python"
        helper = project_root / "scripts" / "print_one.py"
        if not python.exists():
            python = Path(sys.executable)  # fall back to current interpreter

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
                f"subprocess killed, USB freed. Check paper / cover / power. "
                f"Reprint manually: test_printer.py --real --code {code}"
            )
            return

        if result.returncode == 0:
            # stdout looks like "OK 1869ms"
            print(f"[{display_code}]   printed ({result.stdout.strip()})")
        else:
            # stderr has the traceback / error message
            err = (result.stderr or result.stdout).strip().splitlines()
            tail = err[-1] if err else "(no error message)"
            print(f"[{display_code}]   print FAILED rc={result.returncode}: {tail}")

    def _move_to(self, src: Path, dst_dir: Path, prefix: Optional[str] = None):
        dst_dir.mkdir(parents=True, exist_ok=True)
        name = f"{prefix}_{src.name}" if prefix else src.name
        try:
            src.rename(dst_dir / name)
        except OSError:
            # cross-device move fallback — copy + unlink
            import shutil
            shutil.copy2(src, dst_dir / name)
            src.unlink(missing_ok=True)
