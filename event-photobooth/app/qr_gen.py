"""QR code generation for guest download URLs.

The URL is the only secret — anyone with `pikt.ag/rotary/{CODE}` can see those
5 photos. That's intentional and matches Google Photos shared link semantics:
the 8-char Crockford code (32^8 = 1.1 trillion combos) is the gate.
"""

from pathlib import Path

import qrcode
from qrcode.constants import ERROR_CORRECT_M

DEFAULT_DOMAIN = "rotary.pikt.ag"
DEFAULT_ORG = "rotary"  # used for Supabase Storage path prefix, NOT the URL anymore


def url_for(code: str, org: str = DEFAULT_ORG, domain: str = DEFAULT_DOMAIN) -> str:
    """Compose the public download URL for a guest's photo set.

    URL is flat (no org path) since each event lives on its own subdomain:
    rotary.pikt.ag/{code}, lions.pikt.ag/{code}, etc. The `org` parameter
    is kept for callers that still need it (storage path lookup) but
    isn't used in the URL.
    """
    _ = org  # accepted for API compatibility, not embedded in URL
    return f"https://{domain}/{code}"


def make_qr(
    url: str,
    output_path: Path,
    box_size: int = 10,
    border: int = 2,
) -> Path:
    """Render a QR encoding `url` to PNG at `output_path`.

    box_size=10 → ~290px wide for a 25-char URL (typical for our setup).
    Error correction M = 15% redundancy — survives mild print damage / dirt
    without making the QR bigger.
    """
    qr = qrcode.QRCode(
        version=None,  # auto-fit smallest version that holds the data
        error_correction=ERROR_CORRECT_M,
        box_size=box_size,
        border=border,
    )
    qr.add_data(url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="black", back_color="white")
    output_path.parent.mkdir(parents=True, exist_ok=True)
    img.save(output_path)
    return output_path
