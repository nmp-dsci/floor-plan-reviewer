"""Shared narration pipeline: Deepgram Aura voice-over + burned captions + SRT.

Both walkthrough scripts (whats_new / product_tour) drive Playwright and call into
this module so the TTS synthesis, caption bar, scene pacing, SRT export, and audio
mix are defined once. One narration line per scene is spoken, shown as the caption,
and written to the SRT — a single source of truth. Without DEEPGRAM_API_KEY the
video is produced silent (captions only).
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Page

TTS_MODEL = os.environ.get("DEEPGRAM_TTS_MODEL", "aura-2-hyperion-en")


class Narrator:
    def __init__(self, art: Path, voiceover: dict[str, str]) -> None:
        self.art = art
        self.vo = voiceover
        self.vo_dir = art / "vo"
        self.subs: list[tuple[float, str, str]] = []  # (start_s, key, text)
        self.durations: dict[str, float] = {}
        self.t0 = 0.0
        self.voiced = False

    # ---- TTS ----
    def _api_key(self) -> str:
        key = os.environ.get("DEEPGRAM_API_KEY", "")
        if key:
            return key
        env = Path(__file__).parents[1] / ".env"
        if env.exists():
            for line in env.read_text().splitlines():
                if line.startswith("DEEPGRAM_API_KEY="):
                    return line.split("=", 1)[1].strip()
        return ""

    def synthesize(self) -> bool:
        key = self._api_key()
        if not key:
            print("⚠ no DEEPGRAM_API_KEY — recording silent (captions only)")
            return False
        self.vo_dir.mkdir(parents=True, exist_ok=True)
        for name, text in self.vo.items():
            out = self.vo_dir / f"{name}.mp3"
            req = urllib.request.Request(
                f"https://api.deepgram.com/v1/speak?model={TTS_MODEL}&encoding=mp3",
                data=json.dumps({"text": text}).encode(),
                headers={"Authorization": f"Token {key}", "Content-Type": "application/json"},
                method="POST",
            )
            out.write_bytes(urllib.request.urlopen(req, timeout=60).read())
            probe = subprocess.run(
                [
                    "ffprobe",
                    "-v",
                    "error",
                    "-show_entries",
                    "format=duration",
                    "-of",
                    "csv=p=0",
                    out,
                ],
                capture_output=True,
                text=True,
                check=True,
            )
            self.durations[name] = float(probe.stdout.strip())
            print(f"  🔊 {name}: {self.durations[name]:.1f}s")
        self.voiced = True
        return True

    # ---- timeline ----
    def start(self) -> None:
        self.t0 = time.monotonic()

    def caption(self, page: Page, key: str) -> None:
        text = self.vo[key]
        self.subs.append((time.monotonic() - self.t0, key, text))
        page.evaluate(
            """(text) => {
              let bar = document.getElementById('demo-caption');
              if (!bar) {
                bar = document.createElement('div');
                bar.id = 'demo-caption';
                Object.assign(bar.style, {
                  position: 'fixed', left: '0', right: '0', top: '80%', zIndex: '99999',
                  background: 'rgba(20,20,22,0.93)', color: '#fff',
                  font: '600 16.5px/1.45 "Helvetica Neue", Arial, sans-serif',
                  padding: '13px 30px', textAlign: 'center',
                  borderTop: '3px solid #e23d28', borderBottom: '3px solid #e23d28',
                  pointerEvents: 'none',
                });
                document.body.appendChild(bar);
              }
              bar.textContent = text;
            }""",
            text,
        )

    def scene(self, page: Page, key: str, visual_ms: int) -> None:
        """Hold the scene at least as long as its spoken line (plus a beat)."""
        voiced_ms = int(self.durations.get(key, 0) * 1000) + 600
        page.wait_for_timeout(max(visual_ms, voiced_ms))

    # ---- outputs ----
    @staticmethod
    def _srt_time(s: float) -> str:
        ms = int(round(s * 1000))
        return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"

    def _write_srt(self, total: float, stem: str) -> Path:
        out = self.art / f"{stem}.srt"
        blocks = []
        for i, (start, _key, text) in enumerate(self.subs):
            end = self.subs[i + 1][0] if i + 1 < len(self.subs) else total
            blocks.append(f"{i + 1}\n{self._srt_time(start)} --> {self._srt_time(end)}\n{text}\n")
        out.write_text("\n".join(blocks))
        return out

    def _mix(self, silent_mp4: Path, out_mp4: Path) -> None:
        cmd: list[str] = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent_mp4)]
        filters: list[str] = []
        for i, (start, key, _text) in enumerate(self.subs):
            cmd += ["-i", str(self.vo_dir / f"{key}.mp3")]
            filters.append(f"[{i + 1}:a]adelay={int(start * 1000)}:all=1[a{i}]")
        mixspec = "".join(f"[a{i}]" for i in range(len(self.subs)))
        filters.append(f"{mixspec}amix=inputs={len(self.subs)}:normalize=0[aout]")
        cmd += [
            "-filter_complex",
            ";".join(filters),
            "-map",
            "0:v",
            "-map",
            "[aout]",
            "-c:v",
            "copy",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            str(out_mp4),
        ]
        subprocess.run(cmd, check=True)

    def finish(self, final_webm: Path, stem: str) -> None:
        total = time.monotonic() - self.t0
        srt = self._write_srt(total, stem)
        print(f"subtitles: {srt}")
        print(f"video: {final_webm} ({final_webm.stat().st_size // 1024} KB)")
        if not shutil.which("ffmpeg"):
            return
        mp4 = self.art / f"{stem}.mp4"
        if self.voiced:
            silent = self.art / f"_{stem}_silent.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(final_webm), str(silent)],
                check=True,
            )
            self._mix(silent, mp4)
            silent.unlink()
            print(f"video: {mp4} ({mp4.stat().st_size // 1024} KB, narrated · {TTS_MODEL})")
        else:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(final_webm), str(mp4)], check=True
            )
            print(f"video: {mp4} ({mp4.stat().st_size // 1024} KB, silent)")


def take_webm(art: Path, stem: str) -> Path:
    """Rename the most-recent Playwright .webm capture to <stem>.webm."""
    raw = sorted(art.glob("*.webm"), key=lambda p: p.stat().st_mtime)[-1]
    final = art / f"{stem}.webm"
    shutil.move(raw, final)
    return final
