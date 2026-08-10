import bcrypt
import hashlib
import secrets


def hash_password(plain_password: str) -> str:
    # bcrypt has a hard 72-byte input limit; truncate rather than error,
    # since almost no real password approaches that length anyway.
    truncated = plain_password.encode("utf-8")[:72]
    return bcrypt.hashpw(truncated, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    truncated = plain_password.encode("utf-8")[:72]
    return bcrypt.checkpw(truncated, password_hash.encode("utf-8"))


def generate_reset_token() -> tuple[str, str]:
    """Returns (raw_token, token_hash). Only the hash is stored in the DB —
    same principle as passwords, so a DB leak alone can't be used to reset
    anyone's account. The raw token is high-entropy (256 bits) and single-use
    already, so a fast hash (not bcrypt) is appropriate here — there's no
    need for bcrypt's deliberate slowness against a value no one can guess
    or brute-force in the first place."""
    raw_token = secrets.token_urlsafe(32)
    token_hash = hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
    return raw_token, token_hash


def hash_reset_token(raw_token: str) -> str:
    return hashlib.sha256(raw_token.encode("utf-8")).hexdigest()
