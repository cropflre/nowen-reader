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


@unittest.skipUnless(os.name == "posix" and shutil.which("bash"), "Requires POSIX and bash")
class AccessiblePathsRenderTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix="reader-fpk-render-")
        self.root = Path(self.temporary.name)
        self.hooks = self.root / "cmd"
        shutil.copytree(HERE / "template/cmd", self.hooks)
        self.pkgvar = self.root / "pkgvar"
        self.pkgvar.mkdir()
        self.appdest = self.root / "target"
        (self.appdest / "docker").mkdir(parents=True)
        tpl = (HERE / "template/app/docker/docker-compose.yaml.tpl").read_text(encoding="utf-8")
        self.image = "cropflre/nowen-reader:v1.2.4@sha256:" + ("0" * 64)
        self.tpl_content = tpl.replace("{{IMAGE}}", self.image)
        (self.appdest / "docker/docker-compose.yaml.tpl").write_text(self.tpl_content, encoding="utf-8")
        self.compose_path = self.appdest / "docker/docker-compose.yaml"
        self.base_env = {
            **os.environ,
            "TRIM_PKGVAR": str(self.pkgvar),
            "TRIM_APPDEST": str(self.appdest),
            "TRIM_DATA_SHARE_PATHS": "/vol1/@appshare/nowen-reader",
        }

    def tearDown(self):
        self.temporary.cleanup()

    def run_hook(self, name, *args, env=None):
        return subprocess.run(
            ["bash", str(self.hooks / name), *args],
            env=env if env is not None else self.base_env,
            capture_output=True,
            text=True,
        )

    def test_config_callback_mounts_local_and_remote_paths_and_filters_share(self):
        env = {
            **self.base_env,
            "TRIM_DATA_ACCESSIBLE_PATHS": (
                "/vol1/@appshare/nowen-reader/:"
                "/vol1/1000/我的漫画:"
                "/vol02/1000-0-d0b6b52b/Aliyun Drive/小说合集:"
                "/vol1/1000/我的漫画/"
            ),
        }
        result = self.run_hook("config_callback", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = self.compose_path.read_text(encoding="utf-8")
        self.assertIn(f"image: {self.image}", rendered)
        self.assertIn('      - "/vol1/1000/我的漫画:/vol1/1000/我的漫画"', rendered)
        self.assertIn(
            '      - "/vol02/1000-0-d0b6b52b/Aliyun Drive/小说合集:/vol02/1000-0-d0b6b52b/Aliyun Drive/小说合集"',
            rendered,
        )
        # Share path is already mounted as /library and must not be duplicated.
        self.assertNotIn('"/vol1/@appshare/nowen-reader:/vol1/@appshare/nowen-reader"', rendered)
        # Duplicate entry with trailing slash must appear only once.
        self.assertEqual(rendered.count('"/vol1/1000/我的漫画:/vol1/1000/我的漫画"'), 1)

    def test_escapes_yaml_quotes_backslashes_and_compose_dollars(self):
        special_path = r'/vol1/1000/comics "$100" \box'
        env = {**self.base_env, "TRIM_DATA_ACCESSIBLE_PATHS": special_path}
        result = self.run_hook("config_callback", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = self.compose_path.read_text(encoding="utf-8")
        expected_escaped = r'/vol1/1000/comics \"$$100\" \\box'
        self.assertIn(f'      - "{expected_escaped}:{expected_escaped}"', rendered)

    def test_rejects_unsafe_and_reserved_paths(self):
        env = {
            **self.base_env,
            "TRIM_DATA_ACCESSIBLE_PATHS": (
                "/:/data:/data/sub:/library:/app:/etc/passwd:"
                "relative/path:/vol1/../etc:/vol1/bad\nline:/vol1/valid/books"
            ),
        }
        result = self.run_hook("config_callback", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = self.compose_path.read_text(encoding="utf-8")
        self.assertIn('      - "/vol1/valid/books:/vol1/valid/books"', rendered)
        for forbidden in ('"/:/"', '"/data:/data"', '"/data/sub:/data/sub"',
                          '"/library:/library"', '"/app:/app"', '"/etc/passwd:/etc/passwd"',
                          'relative/path', '/vol1/../etc', '/vol1/bad'):
            self.assertNotIn(forbidden, rendered)

    def test_revoking_all_extra_paths_removes_dynamic_mounts(self):
        env_add = {**self.base_env, "TRIM_DATA_ACCESSIBLE_PATHS": "/vol1/1000/comics"}
        self.assertEqual(self.run_hook("config_callback", env=env_add).returncode, 0)
        self.assertIn('"/vol1/1000/comics:/vol1/1000/comics"', self.compose_path.read_text(encoding="utf-8"))

        env_clear = {**self.base_env, "TRIM_DATA_ACCESSIBLE_PATHS": "/vol1/@appshare/nowen-reader"}
        result = self.run_hook("config_callback", env=env_clear)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = self.compose_path.read_text(encoding="utf-8")
        self.assertNotIn("/vol1/1000/comics", rendered)
        self.assertNotIn("Dynamically mounted", rendered)

    def test_upgrade_callback_restores_persisted_mounts_when_env_absent(self):
        env_add = {**self.base_env, "TRIM_DATA_ACCESSIBLE_PATHS": "/vol1/1000/comics:/vol2/novels"}
        self.assertEqual(self.run_hook("config_callback", env=env_add).returncode, 0)

        # Simulate fnOS upgrade unpacking a fresh default docker-compose.yaml without extra mounts.
        self.compose_path.write_text(
            "\n".join(l for l in self.tpl_content.splitlines() if l != "      # __ACCESSIBLE_VOLUMES__") + "\n",
            encoding="utf-8",
        )
        env_upgrade = {k: v for k, v in self.base_env.items() if k != "TRIM_DATA_ACCESSIBLE_PATHS"}
        result = self.run_hook("upgrade_callback", env=env_upgrade)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = self.compose_path.read_text(encoding="utf-8")
        self.assertIn('      - "/vol1/1000/comics:/vol1/1000/comics"', rendered)
        self.assertIn('      - "/vol2/novels:/vol2/novels"', rendered)

    def test_main_start_and_install_callback_render_accessible_paths(self):
        env = {**self.base_env, "TRIM_DATA_ACCESSIBLE_PATHS": "/vol1/1000/manga"}
        result = self.run_hook("install_callback", env=env)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('      - "/vol1/1000/manga:/vol1/1000/manga"', self.compose_path.read_text(encoding="utf-8"))

        env2 = {**self.base_env, "TRIM_DATA_ACCESSIBLE_PATHS": "/vol1/1000/novels"}
        result = self.run_hook("main", "start", env=env2)
        self.assertEqual(result.returncode, 0, result.stderr)
        rendered = self.compose_path.read_text(encoding="utf-8")
        self.assertIn('      - "/vol1/1000/novels:/vol1/1000/novels"', rendered)
        self.assertNotIn("/vol1/1000/manga", rendered)


if __name__ == "__main__":
    unittest.main()
