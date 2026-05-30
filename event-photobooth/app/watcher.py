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
        if self.printer is not None:
            try:
                pr = self.printer.print_receipt(code)
                print(f"[{display_code}]   printed in {pr.duration_ms} ms")
            except Exception as e:
                # Print failure shouldn't kill the whole pipeline — photo's
                # already in cloud, operator can re-print from terminal.
                print(f"[{display_code}]   print FAILED ({type(e).__name__}: {e}) — re-run manually")
        else:
            print(f"[{display_code}]   print skipped (no printer config)")

        self._move_to(path, self.processed_dir, prefix=code)
        print(f"[{display_code}]   ✓ {url}")

        if self.on_ready is not None:
            self.on_ready(code, url, output_dir)

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
