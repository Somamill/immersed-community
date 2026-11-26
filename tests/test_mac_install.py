import importlib.util
from pathlib import Path
import plistlib
import subprocess
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("replace_app", Path(__file__).resolve().parents[1] / "desktop/replace-app.py")
installer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(installer)


class InstallTests(unittest.TestCase):
    def setUp(self):
        sandbox = tempfile.TemporaryDirectory()
        self.addCleanup(sandbox.cleanup)
        self.folder = Path(sandbox.name)
        self.final = self.folder / "immersed.app"
        self.staged = self.folder / "stage" / "immersed.app"
        self.bundle(self.final, "1.0.0")
        self.bundle(self.staged, "1.0.1")
        (self.final / "Contents/obsolete.txt").write_text("old")
        (self.folder / "library.txt").write_text("user data")

    def bundle(self, folder, version):
        binary = folder / "Contents/MacOS/ImmersedMac"
        binary.parent.mkdir(parents=True)
        binary.write_text("test")
        binary.chmod(0o755)
        with (folder / "Contents/Info.plist").open("wb") as file:
            plistlib.dump({"CFBundleIdentifier": installer.IDENTIFIER, "CFBundleExecutable": "ImmersedMac",
                           "CFBundleVersion": version, "CFBundleShortVersionString": version}, file)

    def validate(self, bundle, version, signed):
        self.assertEqual(installer.metadata(bundle)["CFBundleVersion"], version)

    def test_upgrade_removes_old_resources_and_keeps_user_data(self):
        installer.replace(self.staged, self.final, "1.0.1", False, validate=self.validate)
        self.assertFalse((self.final / "Contents/obsolete.txt").exists())
        self.assertEqual((self.folder / "library.txt").read_text(), "user data")
        self.assertEqual(installer.metadata(self.final)["CFBundleVersion"], "1.0.1")

    def test_failed_rename_and_final_verification_restore_previous_bundle(self):
        def failed_move(source, destination):
            if source == self.staged:
                raise OSError("move failed")
            source.rename(destination)
        with self.assertRaisesRegex(OSError, "move failed"):
            installer.replace(self.staged, self.final, "1.0.1", False, validate=self.validate, move=failed_move)
        self.assertEqual(installer.metadata(self.final)["CFBundleVersion"], "1.0.0")

        def invalid_final(bundle, version, signed):
            if bundle == self.final:
                raise ValueError("signature failed at final location")
            self.validate(bundle, version, signed)
        with self.assertRaisesRegex(ValueError, "signature failed"):
            installer.replace(self.staged, self.final, "1.0.1", True, validate=invalid_final)
        self.assertEqual(installer.metadata(self.final)["CFBundleVersion"], "1.0.0")
        self.assertTrue((self.final / "Contents/obsolete.txt").exists())

    def test_wrong_bundle_identity_and_invalid_signature_leave_existing_app_alone(self):
        with self.assertRaises(subprocess.CalledProcessError):
            installer.replace(self.staged, self.final, "1.0.1", True)
        self.assertEqual(installer.metadata(self.final)["CFBundleVersion"], "1.0.0")
        plist = self.final / "Contents/Info.plist"
        with plist.open("rb") as file:
            value = plistlib.load(file)
        value["CFBundleIdentifier"] = "org.example.other"
        with plist.open("wb") as file:
            plistlib.dump(value, file)
        with self.assertRaisesRegex(ValueError, "different application"):
            installer.replace(self.staged, self.final, "1.0.1", False, validate=self.validate)
        self.assertTrue((self.final / "Contents/obsolete.txt").exists())

    def test_next_install_recovers_an_interrupted_backup(self):
        self.final.rename(self.final.with_name(".immersed.previous.app"))
        with self.assertRaises(AssertionError):
            installer.replace(self.staged, self.final, "1.0.2", False, validate=self.validate)
        self.assertEqual(installer.metadata(self.final)["CFBundleVersion"], "1.0.0")
