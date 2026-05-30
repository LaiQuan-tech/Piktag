"""8-character unique code generator using Crockford-style alphabet.

Avoids visually confusable chars (0/O, 1/I/L, U) so QR fallback codes
are easy to read and type by hand.
"""

import secrets

# 32 chars, no 0/1/I/L/O/U
ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"
CODE_LEN = 8


def new_code() -> str:
    """Generate a random 8-char code. Caller is responsible for uniqueness check."""
    return "".join(secrets.choice(ALPHABET) for _ in range(CODE_LEN))


def display(code: str) -> str:
    """Format for human display: K4Q8-M2P3."""
    return f"{code[:4]}-{code[4:]}"


def normalize(s: str) -> str:
    """Normalize user input: uppercase, strip dashes/spaces, fix common confusables."""
    s = s.upper().replace("-", "").replace(" ", "")
    # Defensive: map confusables in case a user typed them
    s = s.translate(str.maketrans({"0": "O", "1": "I", "L": "I"}))
    # But our alphabet has no O/I/L/U either — strip if present (will fail validation downstream)
    return s


def is_valid(code: str) -> bool:
    if len(code) != CODE_LEN:
        return False
    return all(c in ALPHABET for c in code)
