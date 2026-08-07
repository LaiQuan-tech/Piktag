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
UPLOAD_MAX_ATTEMPTS = 15
UPLOAD_BACKOFF_BASE_SEC = 0.2


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
        """Upload composited photos for one guest (1–5 files). Synchronous.

        For the live event loop, call this from a background thread so
        the next photo's processing isn't blocked on network I/O.
        """
        if not files:
            raise ValueError("No files to upload")

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
                        # upsert=true so a network drop mid-upload (request reaches
                        # the server, response is lost) doesn't 409 on retry — the
                        # code is a unique per-session random, overwriting is safe.
                        "upsert": "true",
                    },
                )
                return
            except Exception as e:
                last_err = e
                msg = str(e).lower()
                cls = type(e).__name__
                # 409 Duplicate = the file is ALREADY in storage (a prior retry's
                # request actually succeeded; we just lost its response). The object
                # exists with identical content → treat as success, not failure.
                if "409" in msg or "duplicate" in msg or "already exists" in msg:
                    return
                # Only retry transient/network failures. Auth / bucket-missing will
                # keep failing forever — bail fast. Everything else (bad venue WiFi)
                # gets retried.
                permanent = (
                    "401" in msg or "403" in msg
                    or ("bucket" in msg and "not found" in msg)
                )
                if permanent or attempt == UPLOAD_MAX_ATTEMPTS:
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
