import bcrypt


def hash_password(plain_password: str) -> str:
    # bcrypt has a hard 72-byte input limit; truncate rather than error,
    # since almost no real password approaches that length anyway.
    truncated = plain_password.encode("utf-8")[:72]
    return bcrypt.hashpw(truncated, bcrypt.gensalt()).decode("utf-8")


def verify_password(plain_password: str, password_hash: str) -> bool:
    truncated = plain_password.encode("utf-8")[:72]
    return bcrypt.checkpw(truncated, password_hash.encode("utf-8"))
