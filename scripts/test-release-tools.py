#!/usr/bin/env python3
import argparse
import base64
from contextlib import redirect_stderr, redirect_stdout
import importlib.util
import io
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch


def module(name, filename):
    spec = importlib.util.spec_from_file_location(name, Path(__file__).with_name(filename))
    loaded = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(loaded)
    return loaded


signing = module("signing", "android-signing.py")
release = module("release", "release-metadata.py")


class ReleaseToolsTest(unittest.TestCase):
    def test_manual_candidate_never_publishes_by_default(self):
        result = release.metadata({"INPUT_VERSION": "1.2.4", "GITHUB_RUN_NUMBER": "8"}, "abc")
        self.assertEqual((result["publish"], result["build_number"]), ("false", "1008"))

    def test_tag_release_and_prerelease(self):
        for version, prerelease in (("v1.2.4", "false"), ("v1.2.4-rc.1", "true")):
            result = release.metadata({"GITHUB_EVENT_NAME": "push", "GITHUB_REF_TYPE": "tag",
                "GITHUB_REF_NAME": version, "GITHUB_RUN_NUMBER": "8"}, "abc")
            self.assertEqual((result["publish"], result["prerelease"]), ("true", prerelease))

    def test_branch_or_mismatching_tag_cannot_publish(self):
        for ref, kind in (("main", "branch"), ("v1.2.3", "tag")):
            with self.assertRaises(ValueError):
                release.metadata({"INPUT_VERSION": "1.2.4", "INPUT_PUBLISH": "true",
                    "GITHUB_REF_TYPE": kind, "GITHUB_REF_NAME": ref, "GITHUB_RUN_NUMBER": "8"}, "abc")

    def test_invalid_versions_and_build_numbers_are_rejected(self):
        for version in ("1.2.3\ncommit=other", "1.2.3;echo", "01.2.3", "latest", "1.2"):
            with self.assertRaises(ValueError):
                release.metadata({"INPUT_VERSION": version, "GITHUB_RUN_NUMBER": "8"}, "abc")
        for number in ("0", "-1", "1\nversion=2", "2100000001"):
            with self.assertRaises(ValueError):
                release.metadata({"INPUT_VERSION": "1.2.4", "INPUT_BUILD_NUMBER": number}, "abc")

    def test_missing_secrets_do_not_create_signing_files(self):
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, {}, clear=True):
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "Missing GitHub Secrets"):
                signing.prepare(argparse.Namespace(android_dir=root, signing_dir=root / "signing"))
            self.assertFalse((root / "key.properties").exists())

    def test_prepare_is_private_and_escapes_properties_without_logging_values(self):
        fixture = {"ANDROID_KEYSTORE_BASE64": base64.b64encode(b"fixture-keystore").decode(),
            "ANDROID_KEY_ALIAS": "fixture-alias", "ANDROID_STORE_PASSWORD": "fixture:=\\ value",
            "ANDROID_KEY_PASSWORD": "fixture\n密码"}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, fixture, clear=True):
            root = Path(directory)
            output = io.StringIO()
            with redirect_stdout(output):
                signing.prepare(argparse.Namespace(android_dir=root, signing_dir=root / "signing"))
            properties = (root / "key.properties").read_text()
            self.assertIn("storePassword=fixture\\:\\=\\\\\\ value", properties)
            self.assertIn("keyPassword=fixture\\n\\u5bc6\\u7801", properties)
            self.assertEqual((root / "key.properties").stat().st_mode & 0o777, 0o600)
            self.assertEqual((root / "signing/release.keystore").stat().st_mode & 0o777, 0o600)
            for value in fixture.values():
                self.assertNotIn(value, output.getvalue())

    def test_upload_uses_stdin_and_never_logs_credentials(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / "fixture.keystore").write_bytes(b"fixture-keystore")
            properties = root / "key.properties"
            properties.write_text(f"storeFile={root / 'fixture.keystore'}\nstorePassword=fixture-store\nkeyPassword=fixture-key\nkeyAlias=fixture-alias\n")
            output = io.StringIO()
            with patch.object(signing.subprocess, "run") as run, redirect_stdout(output), redirect_stderr(output):
                run.return_value.returncode = 0
                signing.configure(argparse.Namespace(properties=properties, repo="owner/repo"))
            self.assertEqual(run.call_count, 4)
            for call in run.call_args_list:
                self.assertNotIn("fixture", " ".join(call.args[0]))
                self.assertIn("input", call.kwargs)
            self.assertNotIn("fixture", output.getvalue())

    def test_apk_certificate_supports_old_and_new_build_tools(self):
        expected = "a" * 64
        for label in ("Signer #1", "V2 Signer:", "V3.0 Signer:",
                      "Signer (minSdkVersion=33, maxSdkVersion=2147483647)"):
            with self.subTest(label=label), redirect_stdout(io.StringIO()):
                signing.verify_certificate(f"{label} certificate SHA-256 digest: {expected}\n", expected)

    def test_apk_certificate_checks_every_signer_and_scheme(self):
        expected, other = "a" * 64, "b" * 64
        with redirect_stdout(io.StringIO()):
            signing.verify_certificate(
                f"V2 Signer: certificate SHA-256 digest: {expected.upper()}\r\n"
                f"V3.0 Signer: certificate SHA-256 digest: {expected}\n", expected)
        for label in ("Signer #2", "V3.0 Signer:"):
            with self.subTest(label=label), self.assertRaisesRegex(ValueError, "mismatch"):
                signing.verify_certificate(
                    f"Signer #1 certificate SHA-256 digest: {expected}\n"
                    f"{label} certificate SHA-256 digest: {other}\n", expected)

    def test_source_stamp_and_public_key_cannot_substitute_for_apk_signer(self):
        expected, other = "a" * 64, "b" * 64
        unrelated = (f"Signer #1 public key SHA-256 digest: {expected}\n"
                     f"Source Stamp Signer certificate SHA-256 digest: {expected}\n")
        with self.assertRaisesRegex(ValueError, "No APK signing"):
            signing.verify_certificate(unrelated, expected)
        with self.assertRaisesRegex(ValueError, "mismatch"):
            signing.verify_certificate(unrelated + f"V2 Signer: certificate SHA-256 digest: {other}\n", expected)
        with redirect_stdout(io.StringIO()):
            signing.verify_certificate(
                f"V2 Signer: certificate SHA-256 digest: {expected}\n"
                f"Source Stamp Signer certificate SHA-256 digest: {other}\n", expected)

    def test_malformed_apk_certificate_is_rejected(self):
        with self.assertRaisesRegex(ValueError, "Malformed"):
            signing.verify_certificate("V2 Signer: certificate SHA-256 digest: invalid\n", "a" * 64)
        with self.assertRaisesRegex(ValueError, "Expected a SHA-256"):
            signing.verify_certificate("", "invalid")

    def test_invalid_base64_does_not_create_a_keystore(self):
        fixture = {"ANDROID_KEYSTORE_BASE64": "invalid!", **{v: "fixture" for v in signing.SECRET_KEYS.values()}}
        with tempfile.TemporaryDirectory() as directory, patch.dict(os.environ, fixture, clear=True):
            root = Path(directory)
            with self.assertRaises(ValueError):
                signing.prepare(argparse.Namespace(android_dir=root, signing_dir=root / "signing"))
            self.assertFalse((root / "signing/release.keystore").exists())


if __name__ == "__main__":
    unittest.main()
