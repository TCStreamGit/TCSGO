import os
import sys
import shutil
import subprocess
from pathlib import Path

# ==============================
# Target Format
# ==============================
TARGET_SAMPLE_RATE = "44100"
TARGET_BITRATE = "160k"
TARGET_CHANNELS = "1"  # Mono

OUTPUT_ROOT_NAME = "TCSGO_WAV_TO_MP3"

def run_cmd(cmd: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)

def require_ok(proc: subprocess.CompletedProcess, cmd: list[str]) -> None:
    if proc.returncode != 0:
        msg = (proc.stderr or proc.stdout or "").strip()
        raise RuntimeError(msg if msg else f"Command Failed: {' '.join(cmd)}")

def main() -> int:
    cwd = Path.cwd()
    out_root = cwd / OUTPUT_ROOT_NAME
    out_root.mkdir(parents=True, exist_ok=True)

    ffmpeg = shutil.which("ffmpeg.exe" if os.name == "nt" else "ffmpeg")
    if not ffmpeg:
        print("Error: Ffmpeg Not Found In PATH.", file=sys.stderr)
        print("Fix: Confirm 'ffmpeg -version' Works In This Terminal.", file=sys.stderr)
        return 1

    wavs = [p for p in cwd.rglob("*.wav") if p.is_file()]

    # Skip Anything Already Inside Output Folder
    pruned = []
    for p in wavs:
        try:
            p.relative_to(out_root)
            continue
        except ValueError:
            pruned.append(p)
    wavs = pruned

    if not wavs:
        print("No WAV Files Found To Convert.")
        return 0

    converted = 0
    skipped = 0
    failed = 0

    for wav in wavs:
        rel = wav.relative_to(cwd)
        out_mp3 = out_root / rel.with_suffix(".mp3")
        out_mp3.parent.mkdir(parents=True, exist_ok=True)

        # Skip If Already Converted And Newer
        if out_mp3.exists() and out_mp3.stat().st_mtime >= wav.stat().st_mtime:
            skipped += 1
            continue

        cmd = [
            ffmpeg,
            "-y",
            "-i", str(wav),
            "-ac", TARGET_CHANNELS,
            "-ar", TARGET_SAMPLE_RATE,
            "-b:a", TARGET_BITRATE,
            "-map_metadata", "-1",
            str(out_mp3),
        ]

        try:
            proc = run_cmd(cmd)
            require_ok(proc, cmd)
            converted += 1
            print(f"Converted: {rel} -> {out_mp3.relative_to(cwd)}")
        except Exception as e:
            failed += 1
            print(f"Failed: {rel} | {e}", file=sys.stderr)

    print("")
    print(f"Done. Converted: {converted}. Skipped: {skipped}. Failed: {failed}.")
    print(f"Output Folder: .\\{OUTPUT_ROOT_NAME}\\")
    return 0 if failed == 0 else 2

if __name__ == "__main__":
    raise SystemExit(main())
