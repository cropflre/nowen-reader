#!/usr/bin/env python3
"""Move Android signing material through stdin/Secrets, never command arguments."""

import argparse
import base64
import os
from pathlib import Path
import re
import subprocess
import sys


SECRET_KEYS = {
    "storePassword": "ANDROID_STORE_PASSWORD",
    "keyPassword": "ANDROID_KEY_PASSWORD",
    "keyAlias": "ANDROID_KEY_ALIAS",
}


def read_properties(path):
    result = {}
    # The checked-in example and release server use one key=value per line.
    # Reject unsupported escapes rather than uploading a subtly different key.
    for line in path.read_text(encoding="utf-8").splitlines():
        if not line.strip() or line.lstrip().startswith(("#", "!")):
            continue
        key, separator, value = line.partition("=")
        if not separator or "\\" in value:
            raise ValueError("Use unescaped, single-line key=value signing properties")
        result[key.strip()] = value.lstrip()
    for key in (*SECRET_KEYS, "storeFile"):
        if not result.get(key):
            raise ValueError(f"Missing signing property: {key}")
    return result


def property_value(value):
    escaped = []
    for character in value:
        if character in "\\ =:#!":
            escaped.append("\\" + character)
        elif character in "\n\r\t\f":
            escaped.append({"\n": "\\n", "\r": "\\r", "\t": "\\t", "\f": "\\f"}[character])
        elif ord(character) > 126 or ord(character) < 32:
            encoded = character.encode("utf-16-be")
            escaped.extend("\\u" + encoded[i:i + 2].hex() for i in range(0, len(encoded), 2))
        else:
            escaped.append(character)
    return "".join(escaped)


def configure(args):
    properties = read_properties(args.properties)
    store = Path(properties["storeFile"])
    if not store.is_absolute():
        # Gradle's file(storeFile) resolves relative to android/app.
        store = args.properties.parent / "app" / store
    encoded = base64.b64encode(store.read_bytes()).decode("ascii")
    if not encoded or len(encoded) > 48 * 1024:
        raise ValueError("Keystore is empty or exceeds the GitHub secret size limit")
    values = {"ANDROID_KEYSTORE_BASE64": encoded}
    values.update({secret: properties[key] for key, secret in SECRET_KEYS.items()})
    for name, value in values.items():
        completed = subprocess.run(
            ["gh", "secret", "set", name, "--repo", args.repo],
            input=value, text=True, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
        )
        if completed.returncode:
            raise ValueError(f"Could not set {name}; check gh authentication and repository access")
        print(f"Configured {name}")


def prepare(args):
    names = ("ANDROID_KEYSTORE_BASE64", *SECRET_KEYS.values())
    missing = [name for name in names if not os.environ.get(name)]
    if missing:
        raise ValueError("Missing GitHub Secrets: " + ", ".join(missing))
    try:
        data = base64.b64decode(os.environ["ANDROID_KEYSTORE_BASE64"], validate=True)
    except ValueError:
        raise ValueError("ANDROID_KEYSTORE_BASE64 is not valid base64") from None
    if not data:
        raise ValueError("Keystore is empty")
    args.signing_dir.mkdir(mode=0o700, parents=True, exist_ok=True)
    store = args.signing_dir.resolve() / "release.keystore"
    store.write_bytes(data)
    store.chmod(0o600)
    values = {key: os.environ[secret] for key, secret in SECRET_KEYS.items()}
    values["storeFile"] = str(store)
    path = args.android_dir / "key.properties"
    path.write_text("".join(f"{key}={property_value(value)}\n" for key, value in values.items()), encoding="ascii")
    path.chmod(0o600)
    print("Prepared signing files (values hidden)")


def apk_version_code(build_number, abi):
    # Flutter adds ABI_VERSION * 1000 when --split-per-abi is enabled.
    offsets = {"armeabi-v7a": 1000, "arm64-v8a": 2000, "x86_64": 4000}
    if abi not in offsets:
        raise ValueError("Unsupported APK ABI")
    code = build_number + offsets[abi]
    if build_number < 1 or code > 2100000000:
        raise ValueError("Android build number exceeds the split APK versionCode range")
    return code


def verify_certificate(output, expected):
    expected = expected.lower()
    if not re.fullmatch(r"[0-9a-f]{64}", expected):
        raise ValueError("Expected a SHA-256 certificate fingerprint")
    fingerprints = set()
    for line in output.splitlines():
        label, separator, digest = line.partition(" certificate SHA-256 digest: ")
        # Source stamps identify distribution, not the APK signing identity.
        if not separator or label == "Source Stamp Signer":
            continue
        digest = digest.strip().lower()
        if not re.fullmatch(r"[0-9a-f]{64}", digest):
            raise ValueError("Malformed APK certificate SHA-256 digest")
        fingerprints.add(digest)
    if not fingerprints:
        raise ValueError("No APK signing certificate SHA-256 digest found")
    if fingerprints != {expected}:
        raise ValueError("APK signing certificate mismatch: expected " + expected
                         + ", found " + ", ".join(sorted(fingerprints)))
    print("Verified APK signing certificate SHA-256: " + expected)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest="command", required=True)
    upload = commands.add_parser("configure", help="Run on the existing Linux release server")
    upload.add_argument("--properties", type=Path, required=True)
    upload.add_argument("--repo", required=True)
    local = commands.add_parser("prepare", help="Restore signing files on a GitHub runner")
    local.add_argument("--android-dir", type=Path, required=True)
    local.add_argument("--signing-dir", type=Path, required=True)
    verify = commands.add_parser("verify-certificate", help="Check all APK signer certificate fingerprints")
    verify.add_argument("--output", type=Path, required=True)
    verify.add_argument("--expected", required=True)
    code = commands.add_parser("apk-version-code", help="Expected Flutter split APK versionCode")
    code.add_argument("--build-number", type=int, required=True)
    code.add_argument("--abi", required=True)
    args = parser.parse_args()
    if args.command == "configure" and not re.fullmatch(r"[\w.-]+/[\w.-]+", args.repo):
        parser.error("Expected --repo owner/repository")
    try:
        if args.command == "apk-version-code":
            print(apk_version_code(args.build_number, args.abi))
        elif args.command == "verify-certificate":
            verify_certificate(args.output.read_text(encoding="utf-8"), args.expected)
        else:
            {"configure": configure, "prepare": prepare}[args.command](args)
    except (OSError, ValueError) as error:
        # File contents, subprocess output and credential values are never printed.
        if isinstance(error, OSError):
            print("Signing setup failed: check file paths, permissions and gh installation", file=sys.stderr)
        else:
            print(f"Signing setup failed: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
