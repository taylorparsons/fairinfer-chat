"""List same-origin candidates from a local sitemap for review before import."""
import argparse
from pathlib import Path
from urllib.parse import urlsplit
from xml.etree import ElementTree

LIMIT = 1_000_000
NAMESPACE = "{http://www.sitemaps.org/schemas/sitemap/0.9}"


def candidates(path, origin):
    with path.open("rb") as file:
        xml = file.read(LIMIT + 1)
    if len(xml) > LIMIT or b"<!DOCTYPE" in xml.upper() or b"\x00" in xml:
        raise ValueError("Use a flat UTF-8 sitemap under 1 MB without a DTD")
    root = ElementTree.fromstring(xml.decode("utf-8-sig"))
    namespace = NAMESPACE if root.tag == NAMESPACE + "urlset" else ""
    if root.tag != namespace + "urlset":
        raise ValueError("Use a sitemap urlset. Choose a child sitemap if you have an index.")
    approved = urlsplit(origin)
    if (approved.scheme != "https" or not approved.netloc or approved.username or approved.password
            or approved.path not in {"", "/"} or approved.query or approved.fragment):
        raise ValueError("Use an HTTPS origin without a page path")
    seen = set()
    for node in root.findall(f"{namespace}url/{namespace}loc"):
        url = (node.text or "").strip()
        target = urlsplit(url)
        if (target.scheme, target.netloc.lower()) != (approved.scheme, approved.netloc.lower()):
            continue
        if target.username or target.password or target.query or target.fragment or url in seen:
            continue
        seen.add(url)
        yield url


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", required=True)
    parser.add_argument("sitemap", type=Path)
    args = parser.parse_args()
    try:
        for url in candidates(args.sitemap, args.origin):
            print(url)
    except (OSError, ValueError, ElementTree.ParseError) as error:
        parser.exit(1, f"Could not read sitemap: {error}\n")


if __name__ == "__main__":
    main()
