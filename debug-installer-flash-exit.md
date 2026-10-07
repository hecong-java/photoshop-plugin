# [OPEN] installer-flash-exit

## Symptom
- `packager/lemongrid/dist/1.0.0/LemonGrid_Setup.exe` starts and exits immediately.

## Expected
- The installer should complete automatically after launch without appearing to crash.

## Hypotheses
- H1: `setup.cmd` exits immediately after spawning the real installer, so the EXE appears to flash and close.
- H2: The IExpress `AppLaunched` or quiet command is malformed, so the extracted launcher does not start correctly.
- H3: UAC elevation or hidden-window startup fails, causing the install script not to run.
- H4: `install.ps1` throws at runtime, but the error is not visible because the window closes immediately.

## Evidence
- `LemonGrid_Setup.exe` launches and exits with code `0` immediately in sandbox, with no visible terminal output.
- Direct execution of `install.ps1` completes successfully and installs `lemongrid` into `C:\Program Files\Common Files\Adobe\UXP\Plugins\External\lemongrid`.
- Direct execution of the old `setup.cmd` also exits immediately, matching the visible "flash and close" symptom.
- Root cause is the launcher using `Start-Process` without `-Wait`, so the bootstrap process ends before the actual elevated installer finishes.
- User confirmed the rebuilt installer can now complete installation successfully.
- User also reported hidden legacy `lemongrid` folders were not found, indicating the cleanup scan missed hidden paths and needs stronger validation before deletion.

## Fix
- Updated `packager/lemongrid/setup.cmd` so it waits for the elevated PowerShell installer process and returns its exit code.
- Rebuilt the installer and produced a new package: `packager/lemongrid/dist/1.0.0/LemonGrid_Setup_20260629_143947.exe`.
- Updated `packager/lemongrid/install.ps1` to search hidden legacy folders with `-Force` and only delete directories whose `manifest.json` matches the LemonGrid plugin identity.
- Rebuilt the installer again and produced: `packager/lemongrid/dist/1.0.0/LemonGrid_Setup_20260629_144651.exe`.

## Hypothesis Status
- H1: Confirmed.
- H2: Rejected.
- H3: Not proven as primary cause.
- H4: Rejected.

## Next Step
- Ask the user to verify the latest installer against hidden legacy folders and confirm only real LemonGrid plugin folders are deleted.
