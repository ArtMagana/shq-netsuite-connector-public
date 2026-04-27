from __future__ import annotations

import sys
import unicodedata
from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parent.parent
PATTERNS = (
    "backend/src/**/*.ts",
    "frontend/src/**/*.ts",
    "frontend/src/**/*.tsx",
    "docs/codex/**/*.md",
    ".editorconfig",
    ".gitattributes",
    ".github/workflows/*.yml",
)

BIDI_CODEPOINTS = {
    0x200E,
    0x200F,
    0x202A,
    0x202B,
    0x202C,
    0x202D,
    0x202E,
    0x2066,
    0x2067,
    0x2068,
    0x2069,
}

INVISIBLE_DANGEROUS_CODEPOINTS = {
    0x00AD,
    0x180E,
    0x200B,
    0x200C,
    0x200D,
    0x2060,
    0xFEFF,
}


def iter_files() -> list[Path]:
    files: set[Path] = set()
    for pattern in PATTERNS:
        files.update(path for path in REPO_ROOT.glob(pattern) if path.is_file())
    return sorted(files)


def get_line_col(text: str, index: int) -> tuple[int, int]:
    line = text.count("\n", 0, index) + 1
    line_start = text.rfind("\n", 0, index)
    if line_start == -1:
        column = index + 1
    else:
        column = index - line_start
    return line, column


def describe_codepoint(codepoint: int) -> str:
    return f"U+{codepoint:04X} {unicodedata.name(chr(codepoint), 'UNKNOWN')}"


def report_issue(path: Path, kind: str, detail: str) -> None:
    relative_path = path.relative_to(REPO_ROOT).as_posix()
    print(f"{relative_path}: {kind}: {detail}")


def scan_file(path: Path) -> bool:
    raw = path.read_bytes()
    has_issues = False

    if raw.startswith(b"\xef\xbb\xbf"):
        report_issue(path, "BOM", "UTF-8 BOM detected at file start")
        has_issues = True

    try:
        text = raw.decode("utf-8")
    except UnicodeDecodeError as error:
        report_issue(path, "DECODE_ERROR", f"invalid UTF-8 at byte offset {error.start}")
        return True

    for index, char in enumerate(text):
        codepoint = ord(char)
        if codepoint in BIDI_CODEPOINTS:
            line, column = get_line_col(text, index)
            report_issue(
                path,
                "BIDI",
                f"{describe_codepoint(codepoint)} at line {line}, column {column}",
            )
            has_issues = True
        elif codepoint in INVISIBLE_DANGEROUS_CODEPOINTS:
            line, column = get_line_col(text, index)
            report_issue(
                path,
                "INVISIBLE",
                f"{describe_codepoint(codepoint)} at line {line}, column {column}",
            )
            has_issues = True

    return has_issues


def main() -> int:
    files = iter_files()
    if not files:
        print("No files matched the configured patterns.", file=sys.stderr)
        return 1

    found_issues = False
    for path in files:
        if scan_file(path):
            found_issues = True

    if found_issues:
        return 1

    print(f"OK: scanned {len(files)} files with no BOM or dangerous hidden Unicode characters.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
