#!/usr/bin/env python3
"""Exercise fnOS install timing with a non-root package identity on Linux."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

HERE = Path(__file__).resolve().parent


@unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "Requires Linux and bash")
class InstallLifecycleTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="reader-fpk-lifecycle-")
        self.root = Path(self.temporary.name)
        self.root.chmod(0o755)
        self.uid = 65534 if os.geteuid() == 0 else os.geteuid()
        self.gid = 65534 if os.geteuid() == 0 else os.getegid()
        self.parent = self.root / "platform appdata"
        self.parent.mkdir()
        self.parent.chmod(0o555)
        self.pkgvar = self.parent / "nowen-reader"
        self.hooks = self.root / "cmd"
        shutil.copytree(HERE / "template/cmd", self.hooks)
        self.env = {**os.environ, "TRIM_PKGVAR": str(self.pkgvar)}

    def tearDown(self):
        self.parent.chmod(0o755)
        self.temporary.cleanup()

    def package_user(self):
        if os.geteuid() == 0:
            os.setgroups([])
            os.setgid(self.gid)
            os.setuid(self.uid)

    def run_hook(self, name, env=None):
        return subprocess.run(["bash", str(self.hooks / name)], env=env or self.env,
                              preexec_fn=self.package_user, capture_output=True, text=True)

    def platform_creates_data_directory(self):
        self.parent.chmod(0o755)
        self.pkgvar.mkdir()
        if os.geteuid() == 0:
            os.chown(self.pkgvar, self.uid, self.gid)
        self.parent.chmod(0o555)

    def test_install_init_before_platform_creates_data_directory(self):
        probe = subprocess.run(["mkdir", str(self.pkgvar)], env=self.env,
                               preexec_fn=self.package_user, capture_output=True, text=True)
        self.assertNotEqual(probe.returncode, 0, "Test parent must deny package-user writes")
        result = self.run_hook("install_init")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(self.pkgvar.exists(), "install_init must leave creation to fnOS")

    def test_install_callback_creates_writable_cache_and_preserves_data(self):
        self.platform_creates_data_directory()
        result = self.run_hook("install_callback")
        self.assertEqual(result.returncode, 0, result.stderr)
        for relative in ("data", "cache/thumbnails", "cache/pages"):
            folder = self.pkgvar / relative
            self.assertTrue(folder.is_dir(), relative)
            self.assertEqual(folder.stat().st_uid, self.uid)
        marker = self.pkgvar / "data/keep.db"
        marker.write_bytes(b"existing database")
        result = self.run_hook("install_callback")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_bytes(), b"existing database")
        probe = subprocess.run(["bash", "-c", 'touch "$TRIM_PKGVAR/cache/pages/page-test"'],
                               env=self.env, preexec_fn=self.package_user, capture_output=True, text=True)
        self.assertEqual(probe.returncode, 0, probe.stderr)

    def test_upgrade_preserves_existing_database(self):
        self.platform_creates_data_directory()
        data = self.pkgvar / "data"
        data.mkdir()
        marker = data / "keep.db"
        marker.write_bytes(b"existing database")
        result = self.run_hook("upgrade_init")
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertEqual(marker.read_bytes(), b"existing database")
        self.assertTrue((self.pkgvar / "cache/pages").is_dir())

    def test_install_callback_fails_if_platform_did_not_supply_data_directory(self):
        self.platform_creates_data_directory()
        env = {key: value for key, value in self.env.items() if key != "TRIM_PKGVAR"}
        result = self.run_hook("install_callback", env)
        self.assertNotEqual(result.returncode, 0)
        self.assertEqual(list(self.pkgvar.iterdir()), [])


class PackageIdentityTests(unittest.TestCase):
    def test_display_name_and_desktop_entry_are_chinese(self):
        fields = dict(line.split("=", 1) for line in (HERE / "template/manifest").read_text(encoding="utf-8").splitlines() if "=" in line)
        fields = {key.strip(): value.strip() for key, value in fields.items()}
        ui = json.loads((HERE / "template/app/ui/config").read_text(encoding="utf-8"))
        self.assertEqual(fields["display_name"], "弄文阅读")
        self.assertEqual(ui[".url"][fields["desktop_applaunchname"]]["title"], "弄文阅读")
        self.assertEqual(fields["appname"], "nowen-reader")


if __name__ == "__main__":
    unittest.main()
