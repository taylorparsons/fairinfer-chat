"""Check the Git index, reachable history, or a commit subject."""

import argparse
import os
from pathlib import Path
import re
import subprocess
import sys

SECRET_PATTERNS = (
    r"(AKIA|ASIA)[A-Z0-9]{16}",
    r"github_pat_[A-Za-z0-9_]{60,}|gh[pousr]_[A-Za-z0-9]{36}",
    r"AIza[A-Za-z0-9_-]{35}|[sr]k_live_[A-Za-z0-9]{24,}",
    r"xox[baprs]-[A-Za-z0-9-]{20,}",
    r"-----BEGIN ([A-Z]+ )?PRIVATE KEY-----",
    r"(postgres(ql)?|mysql|mongodb(\+srv)?)://[^:/[:space:]]+:[^@/[:space:]]+@",
    r"""(^|[^[:alnum:]_])(api[_-]?key|secret[_-]?key|password|token)["']?[[:space:]]*[:=][[:space:]]*["'][^"'[:space:]]{12,}["']""",
)
LOCAL_PATHS = (r"/(Users|home)/[[:alnum:]_.-]+/", r"[A-Z]:\\Users\\[^\\]+\\")
LOCAL_FILES = re.compile(
    r"(?:^demo/(?:models|vendor)/|(?:^|/)(?:__pycache__|\.venv)/"
    r"|(?:^|/)(?:\.env(?:\.[^/]*)?|\.DS_Store|[^/]+\.py[cod])$)"
)
CONVENTIONAL_SUBJECT = re.compile(
    r"(?:build|chore|ci|docs|feat|fix|perf|refactor|revert|style|test)"
    r"(?:\([^\s()]+\))?!?: \S.*"
)
GIT_SUBJECT = re.compile(
    r'(?:Merge (?:branch(?:es)?|remote-tracking branch|pull request|commit|tag) .+'
    r'|Revert ".+"|(?:fixup|squash|amend)! .+)'
)


def git_output(*args):
    return subprocess.check_output(["git", *args])


def matching_paths(target, patterns):
    expressions = [arg for pattern in patterns for arg in ("-e", pattern)]
    result = subprocess.run(
        ["git", "grep", "-I", "-l", "-z", "-i", "-E", *expressions, target, "--"],
        stdout=subprocess.PIPE,
    )
    if result.returncode not in (0, 1):
        result.check_returncode()
    return [os.fsdecode(path) for path in result.stdout.split(b"\0") if path]


def scan(target, paths):
    findings = {
        "Possible credential": matching_paths(target, SECRET_PATTERNS),
        "Absolute workstation path": matching_paths(target, LOCAL_PATHS),
        "Local or generated file": [
            os.fsdecode(path) for path in paths.split(b"\0")
            if LOCAL_FILES.search(os.fsdecode(path))
        ],
    }
    for label, matches in findings.items():
        for path in matches:
            print(f"{label} in {target}: {path!r}", file=sys.stderr)
    return not any(findings.values())


def audit():
    clean = scan("--cached", git_output("ls-files", "-z", "--cached"))
    commits = git_output("rev-list", "--all").decode("ascii").splitlines()
    for commit in commits:
        clean &= scan(commit, git_output("ls-tree", "-r", "--name-only", "-z", commit))
    if clean:
        print(f"Git audit passed for the index and {len(commits)} reachable commits.")
    return clean


def validate_message(path):
    message = subprocess.check_output(
        ["git", "stripspace", "--strip-comments"], input=path.read_bytes()
    ).decode("utf-8", errors="replace")
    subject = message.partition("\n")[0]
    if CONVENTIONAL_SUBJECT.fullmatch(subject) or GIT_SUBJECT.fullmatch(subject):
        return True
    print("Use a Conventional Commits subject, for example: fix(chat): keep composer focus",
          file=sys.stderr)
    return False


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("audit")
    commands.add_parser("staged")
    commands.add_parser("commit-message").add_argument("message", type=Path)
    args = parser.parse_args()
    if args.command == "audit":
        return 0 if audit() else 1
    if args.command == "commit-message":
        return 0 if validate_message(args.message) else 1
    if not scan("--cached", git_output("ls-files", "-z", "--cached")):
        return 1
    return subprocess.call(["git", "diff", "--cached", "--check"])


if __name__ == "__main__":
    sys.exit(main())
