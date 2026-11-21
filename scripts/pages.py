"""Build the excerpt-only GitHub Pages demo."""

import argparse
from pathlib import Path
from shutil import copyfile


ROOT = Path(__file__).resolve().parents[1]
FILES = {
    "pages/index.html": "index.html",
    "examples/library/knowledge.json": "knowledge.json",
    "demo/site-chat.mjs": "site-chat/site-chat.mjs",
    "demo/site-chat.css": "site-chat/site-chat.css",
    "demo/site-retrieval.mjs": "site-chat/site-retrieval.mjs",
    "LICENSE": "LICENSE",
}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--output", type=Path, required=True)
    output = parser.parse_args().output
    if output.exists() and (not output.is_dir() or any(output.iterdir())):
        parser.error("the output directory must be empty")
    for source, name in FILES.items():
        destination = output / name
        destination.parent.mkdir(parents=True, exist_ok=True)
        copyfile(ROOT / source, destination)


if __name__ == "__main__":
    main()
