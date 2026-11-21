"""Provision the pinned browser artifacts or serve the chat demo on loopback."""

import argparse
import hashlib
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
import json
from pathlib import Path
from tempfile import NamedTemporaryFile
from urllib.request import urlopen

DEMO = Path(__file__).resolve().parents[1] / "demo"
BLOCK_SIZE = 1024 * 1024


def provision_file(directory, artifact):
    relative = Path(artifact["path"].lstrip("/"))
    if len(relative.parts) < 2 or relative.parts[0] not in {"models", "vendor"} or ".." in relative.parts:
        raise ValueError(f"Unexpected asset path: {relative}")
    target = directory / relative
    if not target.resolve().is_relative_to(directory):
        raise ValueError(f"Asset path leaves the installation directory: {relative}")
    size = artifact["bytes"]
    expected = artifact["sha256"]
    if target.is_file() and target.stat().st_size == size:
        with target.open("rb") as existing:
            if hashlib.file_digest(existing, "sha256").hexdigest() == expected:
                print(f"Verified {relative}", flush=True)
                return

    target.parent.mkdir(parents=True, exist_ok=True)
    print(f"Downloading {relative} ({size:,} bytes)", flush=True)
    digest = hashlib.sha256()
    received = 0
    with NamedTemporaryFile(dir=target.parent, delete=False) as partial:
        temp_path = Path(partial.name)
    try:
        with urlopen(artifact["url"], timeout=60) as response, temp_path.open("wb") as output:
            while chunk := response.read(BLOCK_SIZE):
                received += len(chunk)
                if received > size:
                    raise ValueError(f"Download exceeded the pinned size for {relative}")
                digest.update(chunk)
                output.write(chunk)
        if received != size or digest.hexdigest() != expected:
            raise ValueError(f"Download did not match the pinned SHA-256 or size for {relative}")
        temp_path.replace(target)
    finally:
        temp_path.unlink(missing_ok=True)


class DemoHandler(SimpleHTTPRequestHandler):
    extensions_map = {
        **SimpleHTTPRequestHandler.extensions_map,
        ".wasm": "application/wasm",
        ".mjs": "text/javascript",
    }

    def end_headers(self):
        self.send_header(
            "Content-Security-Policy",
            "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; "
            "worker-src 'self' blob:; object-src 'none'; base-uri 'none'; "
            "form-action 'none'; frame-ancestors 'none'",
        )
        self.send_header("Cross-Origin-Opener-Policy", "same-origin")
        self.send_header("Cross-Origin-Embedder-Policy", "require-corp")
        self.send_header("X-Content-Type-Options", "nosniff")
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=("provision", "serve"))
    parser.add_argument("--port", type=int, default=8787, help="Loopback port for serve")
    parser.add_argument("--directory", type=Path, default=DEMO, help="Site or widget directory")
    args = parser.parse_args()
    directory = args.directory.resolve()

    if args.command == "provision":
        try:
            release = json.loads((directory / "assets/model-release.json").read_text(encoding="utf-8"))
            for artifact in release["files"]:
                provision_file(directory, artifact)
        except (OSError, ValueError) as error:
            parser.exit(1, f"Provisioning failed: {error}\n")
        print("Verified all pinned model and runtime files.")
    else:
        handler = partial(DemoHandler, directory=directory)
        with ThreadingHTTPServer(("127.0.0.1", args.port), handler) as server:
            print(f"Open http://127.0.0.1:{server.server_port}/?chat-debug=1", flush=True)
            try:
                server.serve_forever()
            except KeyboardInterrupt:
                pass


if __name__ == "__main__":
    main()
