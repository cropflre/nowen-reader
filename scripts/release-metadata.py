#!/usr/bin/env python3
"""Validate Actions inputs before passing them to build tools or registries."""
from datetime import datetime, timezone
import json
import os
from pathlib import Path
import re
import subprocess
import sys


def metadata(env, commit):
    tagged = env.get("GITHUB_REF_TYPE") == "tag"
    version = env.get("INPUT_VERSION", "").strip()
    if not version and tagged:
        version = env["GITHUB_REF_NAME"]
    version = version.removeprefix("v")
    number = r"(?:0|[1-9][0-9]*)"
    if not re.fullmatch(rf"{number}\.{number}\.{number}(?:-(?:alpha|beta|rc)\.[1-9][0-9]*)?", version):
        raise ValueError("Expected version X.Y.Z or X.Y.Z-rc.N (alpha/beta also supported)")
    tag = "v" + version
    publish = env.get("GITHUB_EVENT_NAME") == "push" or env.get("INPUT_PUBLISH") == "true"
    if publish and (not tagged or env.get("GITHUB_REF_NAME") != tag):
        raise ValueError("Publication must run against the matching existing vVERSION tag")
    raw_number = env.get("INPUT_BUILD_NUMBER", "").strip()
    if not raw_number:
        raw_number = str(int(env.get("BUILD_NUMBER_BASE") or "1000") + int(env["GITHUB_RUN_NUMBER"]))
    if not re.fullmatch(r"[1-9][0-9]*", raw_number) or int(raw_number) > 2099996000:
        raise ValueError("Android build number must be an integer from 1 to 2099996000")
    return {
        "version": version,
        "tag": tag,
        "commit": commit,
        "build_number": raw_number,
        "build_time": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "publish": str(publish).lower(),
        "prerelease": str("-" in version).lower(),
    }


def main():
    commit = subprocess.check_output(["git", "rev-parse", "HEAD"], text=True).strip()
    try:
        values = metadata(os.environ, commit)
    except (ValueError, KeyError):
        print("Invalid release inputs: use a valid version and build number; publishing requires its matching version tag", file=sys.stderr)
        return 1
    Path("release-info.json").write_text(json.dumps(values, indent=2) + "\n")
    with open(os.environ["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
        for key, value in values.items():
            output.write(f"{key}={value}\n")
    print(f"Prepared {values['tag']} from {commit} (publish={values['publish']})")
    return 0


if __name__ == "__main__":
    sys.exit(main())
