"""Check locked Rust packages and pinned browser runtimes against OSV."""
import json
from pathlib import Path
import sys
import tomllib
from urllib.request import Request, urlopen

ROOT = Path(__file__).resolve().parents[1]


def main():
    with (ROOT / "importer/Cargo.lock").open("rb") as lock:
        crates = tomllib.load(lock)["package"]
    packages = [
        ("crates.io", package["name"], package["version"])
        for package in crates if package.get("source", "").startswith("registry+")
    ]
    manifest = json.loads((ROOT / "demo/assets/model-release.json").read_text(encoding="utf-8"))
    for name in ("@huggingface/transformers", "onnxruntime-web"):
        marker = "/npm/" + name + "@"
        url = next(file["url"] for file in manifest["files"] if marker in file["url"])
        packages.append(("npm", name, url.split(marker, 1)[1].split("/", 1)[0]))
    queries = [
        {"package": {"ecosystem": ecosystem, "name": name}, "version": version}
        for ecosystem, name, version in packages
    ]
    req = Request(
        "https://api.osv.dev/v1/querybatch",
        data=json.dumps({"queries": queries}).encode(),
        headers={"Content-Type": "application/json"},
    )
    with urlopen(req, timeout=45) as response:
        results = json.load(response)["results"]
    if len(results) != len(packages):
        raise ValueError("OSV returned an incomplete result")
    findings = 0
    for package, result in zip(packages, results, strict=True):
        for vulnerability in result.get("vulns", []):
            findings += 1
            print(*package, vulnerability["id"])
    print(f"OSV checked {len(packages)} package versions: {findings} advisories.")
    return int(bool(findings))


if __name__ == "__main__":
    sys.exit(main())
