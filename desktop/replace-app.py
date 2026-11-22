"""Replace the complete Immersed bundle on the destination volume."""
import fcntl
import os
from pathlib import Path
import plistlib
import signal
import subprocess
import sys

IDENTIFIER = "com.somamill.immersedmac"
CODESIGN = "/usr/bin/codesign"


def metadata(bundle):
    if bundle.is_symlink() or not bundle.is_dir():
        raise ValueError(f"Invalid application bundle: {bundle}")
    with (bundle / "Contents" / "Info.plist").open("rb") as file:
        value = plistlib.load(file)
    if value.get("CFBundleIdentifier") != IDENTIFIER:
        raise ValueError(f"Cannot replace a different application: {bundle}")
    executable = bundle / "Contents" / "MacOS" / "ImmersedMac"
    if value.get("CFBundleExecutable") != "ImmersedMac" or not executable.is_file() or not os.access(executable, os.X_OK):
        raise ValueError(f"Missing Immersed executable: {bundle}")
    return value


def verify(bundle, version, signing):
    value = metadata(bundle)
    if value["CFBundleShortVersionString"] != version or value["CFBundleVersion"] != version:
        raise ValueError(f"Unexpected application version: {bundle}")
    if signing:
        subprocess.run(
            [CODESIGN, "--verify", "--deep", "--strict", "-R",
             f'=anchor apple generic and identifier "{IDENTIFIER}" and certificate leaf[field.1.2.840.113635.100.6.1.13] exists',
             str(bundle)], check=True,
        )
        return
    subprocess.run([CODESIGN, "--verify", "--deep", "--strict", str(bundle)], check=True)


def replace(staged, final, version, signed, *, validate=verify, move=os.rename):
    backup = final.with_name(".immersed.previous.app")
    with (final.parent / ".immersed-install.lock").open("a") as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        if backup.exists() or backup.is_symlink():
            # An interrupted transaction never destroys its previous bundle.
            metadata(backup)
            if final.exists() or final.is_symlink():
                metadata(final)
                abandoned = staged.parent / "interrupted.app"
                move(final, abandoned)
            else:
                abandoned = None
            try:
                move(backup, final)
            except BaseException:
                if abandoned is not None and not final.exists():
                    move(abandoned, final)
                raise
        validate(staged, version, signed)
        if final.exists() or final.is_symlink():
            metadata(final)
            # An unsigned development build cannot replace a Developer ID app.
            requirements = subprocess.run([CODESIGN, "-dv", "--verbose=4", str(final)], capture_output=True)
            if not signed and b"Authority=Developer ID Application:" in requirements.stderr:
                raise ValueError("Use a signed release to replace the installed Developer ID app.")
        replaced = False
        try:
            if final.exists():
                move(final, backup)
            move(staged, final)
            replaced = True
            validate(final, version, signed)
        except BaseException:
            if replaced or (not staged.exists() and final.exists()):
                move(final, staged)
            if backup.exists() and not final.exists():
                move(backup, final)
            raise
        if backup.exists():
            # The final app has already been verified. Retire the backup in one rename,
            # so an interrupted cleanup cannot look like an unfinished transaction.
            move(backup, staged.parent / "retired.app")


def interrupted(_signal, _frame):
    raise InterruptedError("Installation interrupted")


if __name__ == "__main__":
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGHUP, interrupted)
    try:
        replace(Path(sys.argv[1]), Path(sys.argv[2]), sys.argv[3], sys.argv[4] == "signed")
    except (OSError, ValueError, KeyError, subprocess.CalledProcessError) as error:
        sys.exit(str(error))
