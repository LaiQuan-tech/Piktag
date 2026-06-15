"""Supabase Storage uploader.

Uses supabase-py (the official Python SDK). Authentication via service_role key
which bypasses RLS — kept in .env, never shipped to clients.

Object path convention (must match landing page's expected layout):
    {org}/{code}/{1-5}.jpg

Bucket is expected to be PUBLIC. The 8-char unguessable code is the gate —
same model as Google Photos shared links. Private bucket + signed URLs is
a future option if we want hard privacy + revocability.
"""

from __future__ import annotations

import time
from dataclasses import dataclass
from pathlib import Path

from supabase import Client, create_client

from .config import SupabaseConfig

# Per-file retry policy for transient network failures (ConnectError, read/write
# timeouts, "Connection reset by peer"). At the event we'd rather wait 7 seconds
# than fail the whole pipeline + miss the print. Backoff: 0.5s, 1s, 2s, 4s.
UPLOAD_MAX_ATTEMPTS = 4
UPLOAD_BACKOFF_BASE_SEC = 0.5


@dataclass
class UploadResult:
    code: str
    keys: list[str]
    public_urls: list[str]
    bytes_uploaded: int
    duration_ms: int


class SupabaseUploader:
    def __init__(self, cfg: SupabaseConfig):
        self.cfg = cfg
        self.client: Client = create_client(cfg.url, cfg.service_role_key)

    def check_connection(self) -> tuple[bool, str]:
        """Verify URL + key + bucket all work. Used by test scripts + startup."""
        try:
            # list_buckets needs service_role key — also confirms key is valid
            buckets = self.client.storage.list_buckets()
            names = {b.name for b in buckets}
            if self.cfg.bucket not in names:
                return False, f"bucket '{self.cfg.bucket}' not found. Existing: {sorted(names)}"
            return True, "ok"
        except Exception as e:
            return False, f"{type(e).__name__}: {e}"

    def upload_set(self, code: str, files: list[Path]) -> UploadResult:
        """Upload 5 composited photos for one guest. Synchronous.

        For the live event loop, call this from a background thread so
        the next photo's processing isn't blocked on network I/O.
        """
        if len(files) != 5:
            raise ValueError(f"Expected 5 files, got {len(files)}")

        t0 = time.perf_counter()
        keys: list[str] = []
        public_urls: list[str] = []
        total_bytes = 0

        storage = self.client.storage.from_(self.cfg.bucket)
        for idx, f in enumerate(files, start=1):
            key = f"{self.cfg.org}/{code}/{idx}.jpg"
            data = f.read_bytes()
            self._upload_one_with_retry(storage, key, data)
            keys.append(key)
            public_urls.append(self.public_url_for(code, idx))
            total_bytes += len(data)

        duration_ms = int((time.perf_counter() - t0) * 1000)
        return UploadResult(
            code=code,
            keys=keys,
            public_urls=public_urls,
            bytes_uploaded=total_bytes,
            duration_ms=duration_ms,
        )

    def _upload_one_with_retry(self, storage, key: str, data: bytes):
        """Upload one object, retrying transient network errors with exponential
        backoff. Permanent errors (auth, quota, bucket missing) surface immediately
        so we don't waste time retrying something that will never work."""
        import time as _time
        last_err: Optional[Exception] = None
        for attempt in range(1, UPLOAD_MAX_ATTEMPTS + 1):
            try:
                storage.upload(
                    path=key,
                    file=data,
                    file_options={
                        "content-type": "image/jpeg",
                        "cache-control": "public, max-age=2592000, immutable",
                        "upsert": "false",
                    },
                )
                return
            except Exception as e:
                last_err = e
                msg = str(e).lower()
                cls = type(e).__name__
                # Only retry transient/network failures. Anything else (401, 409,
                # bucket-not-found, etc.) will keep failing forever — bail fast.
                transient = (
                    "timeout" in msg
                    or "timed out" in msg
                    or "connection reset" in msg
                    or "connection aborted" in msg
                    or "server disconnected" in msg
                    or "disconnected" in msg
                    or "connect" in cls.lower()
                    or "timeout" in cls.lower()
                    or "remoteprotocol" in cls.lower()
                    or "protocol" in cls.lower()
                )
                if not transient or attempt == UPLOAD_MAX_ATTEMPTS:
                    raise
                wait = UPLOAD_BACKOFF_BASE_SEC * (2 ** (attempt - 1))
                print(
                    f"  upload retry {attempt}/{UPLOAD_MAX_ATTEMPTS} "
                    f"after {cls} on {key} — waiting {wait:.1f}s"
                )
                _time.sleep(wait)
        if last_err is not None:
            raise last_err

    def public_url_for(self, code: str, index: int) -> str:
        """Return the canonical public URL for a stored photo.

        Format: {SUPABASE_URL}/storage/v1/object/public/{bucket}/{org}/{code}/{idx}.jpg
        """
        key = f"{self.cfg.org}/{code}/{index}.jpg"
        return self.client.storage.from_(self.cfg.bucket).get_public_url(key)
