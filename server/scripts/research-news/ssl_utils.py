#!/usr/bin/env python3
"""
Shared SSL helpers for research-news scripts.

Some local Python installs have broken default OpenSSL verify paths on macOS.
This module chooses a usable CA bundle explicitly so HTTPS requests work
without disabling certificate verification.
"""

from __future__ import annotations

import os
import ssl
from typing import List, Optional, Tuple

CA_ENV_KEYS = [
    "DR_CLAW_CA_BUNDLE",
    "SSL_CERT_FILE",
    "REQUESTS_CA_BUNDLE",
    "CURL_CA_BUNDLE",
    "NODE_EXTRA_CA_CERTS",
]

CA_FILE_CANDIDATES = [
    "/etc/ssl/cert.pem",
    "/etc/ssl/certs/ca-certificates.crt",
    "/usr/local/etc/openssl@3/cert.pem",
    "/opt/homebrew/etc/openssl@3/cert.pem",
]


def _candidate_ca_files() -> List[str]:
    candidates: List[str] = []

    for key in CA_ENV_KEYS:
        value = os.environ.get(key)
        if value:
            candidates.append(value)

    default_paths = ssl.get_default_verify_paths()
    if default_paths.cafile:
        candidates.append(default_paths.cafile)

    try:
        import certifi  # type: ignore

        candidates.append(certifi.where())
    except Exception:
        pass

    candidates.extend(CA_FILE_CANDIDATES)

    unique: List[str] = []
    seen = set()
    for path in candidates:
        if path and path not in seen and os.path.exists(path):
            seen.add(path)
            unique.append(path)
    return unique


def create_ssl_context() -> Tuple[ssl.SSLContext, Optional[str]]:
    last_error: Optional[Exception] = None
    for cafile in _candidate_ca_files():
        try:
            return ssl.create_default_context(cafile=cafile), cafile
        except Exception as err:
            last_error = err

    if last_error is not None:
        raise RuntimeError(f"Failed to initialize SSL context from available CA bundles: {last_error}") from last_error

    return ssl.create_default_context(), None
