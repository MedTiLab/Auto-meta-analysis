#!/usr/bin/env python3
"""Small stdlib client for the MedHelp local database API."""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import time
from pathlib import Path
from urllib.parse import urlencode
from urllib.request import Request, urlopen


# Try the current local-dev port first, then the packaged/production default.
DEFAULT_BASE_CANDIDATES = ("http://127.0.0.1:8787", "http://127.0.0.1:8878")
DEFAULT_BASE_URL = DEFAULT_BASE_CANDIDATES[0]
REPO_ROOT = Path(__file__).resolve().parents[3]
DEFAULT_SOCKET = "/opt/medtimehelp/.runtime/database-api.sock"
DEFAULT_DEPLOY_DIRS = (
    Path("/opt/medtimehelp/database"),
    REPO_ROOT / "database",
)


def _probe(base: str, timeout: float = 3.0) -> bool:
    """Return True if base/api/v1/health answers (used to auto-detect the port)."""
    try:
        with urlopen(base.rstrip("/") + "/api/v1/health", timeout=timeout) as response:
            return 200 <= getattr(response, "status", 200) < 300
    except Exception:
        return False


def env_base_url() -> str:
    explicit = os.environ.get("MEDHELP_DATABASE_API_URL") or os.environ.get("DATABASE_API_URL")
    if explicit:
        return explicit.rstrip("/")
    for base in DEFAULT_BASE_CANDIDATES:
        if _probe(base):
            return base
    # Nothing answered; return the first candidate so request() surfaces a clear
    # connection error instead of silently using a wrong host.
    return DEFAULT_BASE_URL


def env_token() -> str:
    return os.environ.get("MEDHELP_DATABASE_API_TOKEN") or os.environ.get("DATABASE_API_TOKEN") or ""


def headers(args: argparse.Namespace, content_type: str | None = None) -> dict[str, str]:
    result: dict[str, str] = {}
    token = args.token or env_token()
    if token:
        result["Authorization"] = f"Bearer {token}"
    if args.device_id:
        result["X-Device-ID"] = args.device_id
    if content_type:
        result["Content-Type"] = content_type
    return result


def request(
    args: argparse.Namespace,
    method: str,
    path: str,
    *,
    query: dict[str, object] | None = None,
    body: dict[str, object] | None = None,
) -> bytes:
    base_url = (args.base_url or env_base_url()).rstrip("/")
    url = base_url + path
    if query:
        url += "?" + urlencode({k: v for k, v in query.items() if v is not None and v != ""})
    payload = None
    content_type = None
    if body is not None:
        payload = json.dumps(body, ensure_ascii=False).encode("utf-8")
        content_type = "application/json"
    req = Request(url, data=payload, method=method, headers=headers(args, content_type))
    with urlopen(req, timeout=args.timeout) as response:
        return response.read()


def print_json(data: bytes) -> None:
    try:
        payload = json.loads(data.decode("utf-8"))
    except Exception:
        sys.stdout.buffer.write(data)
        return
    print(json.dumps(payload, ensure_ascii=False, indent=2))


def write_or_print(data: bytes, output: str | None) -> None:
    if output:
        Path(output).expanduser().resolve().write_bytes(data)
        print(output)
    else:
        sys.stdout.buffer.write(data)


def split_csv(value: str) -> list[str]:
    return [item.strip() for item in value.split(",") if item.strip()]


def cmd_health(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/health"))


def cmd_sources(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/sources"))


def cmd_source(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", f"/source/{args.source}"))


def cmd_manifest(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/manifest", query={"source": args.source}))


def cmd_search(args: argparse.Namespace) -> None:
    body = {
        "q": args.q,
        "source": args.source,
        "kind": args.kind,
        "match": args.match,
        "limit": args.limit,
    }
    print_json(request(args, "POST", "/search", body=body))


def cmd_batch(args: argparse.Namespace) -> None:
    body = {
        "q": args.q,
        "source": args.source,
        "kind": args.kind,
        "match": args.match,
        "limit": args.limit,
    }
    print_json(request(args, "POST", "/search/batch", body=body))


def cmd_resolve(args: argparse.Namespace) -> None:
    print_json(request(args, "GET", "/resolve", query={"source": args.source, "file": args.file}))


def cmd_schema(args: argparse.Namespace) -> None:
    print_json(
        request(
            args,
            "GET",
            "/schema",
            query={"source": args.source, "file": args.file, "object": args.object},
        )
    )


def cmd_extract(args: argparse.Namespace) -> None:
    data = request(
        args,
        "GET",
        "/extract",
        query={
            "source": args.source,
            "file": args.file,
            "columns": args.columns,
            "limit": args.limit,
            "offset": args.offset,
            "sheet": args.sheet,
            "object": args.object,
            "format": args.format,
        },
    )
    if args.format == "csv":
        write_or_print(data, args.output)
    else:
        print_json(data)


def find_start_script(explicit_deploy_dir: str | None) -> Path:
    candidates: list[Path] = []
    if explicit_deploy_dir:
        candidates.append(Path(explicit_deploy_dir).expanduser())
    env_dir = os.environ.get("MEDHELP_DATABASE_DEPLOY_DIR")
    if env_dir:
        candidates.append(Path(env_dir).expanduser())
    candidates.extend(DEFAULT_DEPLOY_DIRS)
    for deploy_dir in candidates:
        script = deploy_dir / "start_deploy_api.sh"
        if script.exists():
            return script.resolve()
    raise SystemExit(
        "Cannot find start_deploy_api.sh. Set MEDHELP_DATABASE_DEPLOY_DIR to the database deploy directory."
    )


def stop_port(port: int, wait_seconds: float = 2.0) -> None:
    try:
        found = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
    except FileNotFoundError:
        return
    pids = [pid for pid in found.stdout.split() if pid.strip()]
    if not pids:
        return
    subprocess.run(["kill", *pids], check=False)
    deadline = time.time() + wait_seconds
    while time.time() < deadline:
        check = subprocess.run(
            ["lsof", "-ti", f"tcp:{port}", "-sTCP:LISTEN"],
            check=False,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        if not check.stdout.strip():
            return
        time.sleep(0.2)


def cmd_start(args: argparse.Namespace) -> None:
    script = find_start_script(args.deploy_dir)
    socket_path = args.socket.strip()
    if args.restart and not socket_path:
        stop_port(args.port)
    env = os.environ.copy()
    env["MEDHELP_DATABASE_API_URL"] = f"http://{args.host}:{args.port}"
    env["DATABASE_API_PORT"] = str(args.port)
    argv = ["bash", str(script)]
    if socket_path:
        argv.extend([
            "--socket",
            socket_path,
            "--allowed-origins",
            f"http://localhost:{args.port},http://127.0.0.1:{args.port}",
        ])
    else:
        argv.extend(["--host", args.host, "--port", str(args.port)])
    argv.extend(["--idle-timeout-seconds", str(args.idle_timeout_seconds)])
    if args.require_token:
        argv.append("--require-token")
    os.execvpe("bash", argv, env)


def add_common(parser: argparse.ArgumentParser) -> None:
    parser.add_argument("--base-url", default="", help="API base URL. Defaults to MEDHELP_DATABASE_API_URL, else auto-detects http://127.0.0.1:8787 then :8878.")
    parser.add_argument("--token", default="", help="Bearer token. Prefer MEDHELP_DATABASE_API_TOKEN.")
    parser.add_argument("--device-id", default="", help="Optional X-Device-ID header.")
    parser.add_argument("--timeout", type=float, default=60.0)


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Client for the MedHelp local database API.")
    sub = parser.add_subparsers(dest="command", required=True)

    for name, fn in (("health", cmd_health), ("sources", cmd_sources)):
        p = sub.add_parser(name)
        add_common(p)
        p.set_defaults(func=fn)

    p = sub.add_parser("source")
    add_common(p)
    p.add_argument("--source", required=True)
    p.set_defaults(func=cmd_source)

    p = sub.add_parser("manifest")
    add_common(p)
    p.add_argument("--source", required=True)
    p.set_defaults(func=cmd_manifest)

    p = sub.add_parser("search")
    add_common(p)
    p.add_argument("--q", required=True)
    p.add_argument("--source", default="")
    p.add_argument("--kind", default="auto")
    p.add_argument("--match", default="all", choices=("all", "any"))
    p.add_argument("--limit", type=int, default=20)
    p.set_defaults(func=cmd_search)

    p = sub.add_parser("batch")
    add_common(p)
    p.add_argument("--q", required=True, action="append", help="Query term. Repeat for multiple terms.")
    p.add_argument("--source", default="")
    p.add_argument("--kind", default="auto")
    p.add_argument("--match", default="all", choices=("all", "any"))
    p.add_argument("--limit", type=int, default=10)
    p.set_defaults(func=cmd_batch)

    p = sub.add_parser("resolve")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    p.set_defaults(func=cmd_resolve)

    p = sub.add_parser("schema")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--object", default="")
    p.set_defaults(func=cmd_schema)

    p = sub.add_parser("extract")
    add_common(p)
    p.add_argument("--source", required=True)
    p.add_argument("--file", required=True)
    p.add_argument("--columns", default="")
    p.add_argument("--limit", type=int, default=50)
    p.add_argument("--offset", type=int, default=0)
    p.add_argument("--sheet", default="")
    p.add_argument("--object", default="")
    p.add_argument("--format", choices=("json", "csv"), default="json")
    p.add_argument("--output", default="")
    p.set_defaults(func=cmd_extract)

    p = sub.add_parser("start")
    p.add_argument("--deploy-dir", default="", help="Directory containing start_deploy_api.sh.")
    p.add_argument("--host", default="127.0.0.1")
    p.add_argument("--port", type=int, default=8787)
    p.add_argument("--socket", default=os.environ.get("DATABASE_API_SOCKET", DEFAULT_SOCKET), help="Unix socket path for the database sidecar. Pass an empty string only for explicit TCP maintenance.")
    p.add_argument("--idle-timeout-seconds", type=int, default=0)
    p.add_argument("--require-token", action="store_true")
    p.add_argument("--restart", action="store_true", help="Kill the old TCP listener on --port before starting when --socket is empty.")
    p.set_defaults(func=cmd_start)

    return parser


def main() -> int:
    args = build_parser().parse_args()
    args.func(args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
