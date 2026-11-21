"""Build a static install ZIP and its SHA-256 checksum."""

import argparse
import hashlib
from pathlib import Path
import re
from zipfile import ZIP_DEFLATED, ZipFile

ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "LICENSE": "LICENSE",
    "INSTALL.md": "INSTALL.md",
    "scripts/demo.py": "setup.py",
    "demo/site-chat.mjs": "site-chat.mjs",
    "demo/site-chat.css": "site-chat.css",
    "demo/site-retrieval.mjs": "site-retrieval.mjs",
}
for name in (
    "gemma-worker.js", "model-release.json", "gemma-TERMS.txt", "Gemma-Notice.txt",
    "onnxruntime-LICENSE.txt", "transformers-LICENSE.txt",
):
    FILES[f"demo/assets/{name}"] = f"assets/{name}"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--version", default="0.1.1")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?", args.version):
        parser.error("version must be a semantic version")
    args.output.mkdir(parents=True, exist_ok=True)
    archive = args.output / f"site-chat-{args.version}.zip"
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as bundle:
        for source, name in FILES.items():
            bundle.writestr(f"site-chat/{name}", (ROOT / source).read_bytes())
    digest = hashlib.sha256(archive.read_bytes()).hexdigest()
    archive.with_suffix(".zip.sha256").write_text(f"{digest}  {archive.name}\n", encoding="ascii")
    print(archive)


if __name__ == "__main__":
    main()
