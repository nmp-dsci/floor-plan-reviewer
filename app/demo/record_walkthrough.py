"""Record the narrated Floor-Plan Studio walkthrough against the running compose stack.

Drives a real browser through the 231 Peats Ferry Rd review — library, proposed
plan, delta view, git-style register, room + wall-chunk multi-select, a live
agent round-trip producing a new version — and delivers:

    artifacts/walkthrough.mp4   video + Deepgram Aura voice-over (en-AU)
    artifacts/walkthrough.webm  silent video
    artifacts/walkthrough.srt   the narration with measured timestamps
    artifacts/NN-*.png          stills per scene

Narration lines are compact on purpose: each is spoken (Deepgram TTS), shown as
the burned-in caption bar, and written to the SRT — one source of truth. Scene
pauses stretch to fit each spoken clip. Without DEEPGRAM_API_KEY the video is
produced silent, captions only.
"""

from __future__ import annotations

import json
import os
import shutil
import subprocess
import time
import urllib.request
from pathlib import Path

from playwright.sync_api import Page, expect, sync_playwright

BASE = "http://localhost:5175"
ART = Path(__file__).parent / "artifacts"
VO_DIR = ART / "vo"
TTS_MODEL = os.environ.get("DEEPGRAM_TTS_MODEL", "aura-2-hyperion-en")
COMMENT = (
    "Convert the store into a home office called STUDY (habitable, white fill), "
    "and open a servery window in the selected section of this wall between the "
    "living area and the kitchen."
)

# One line per scene: spoken by TTS, burned in as the caption, written to the SRT.
VOICEOVER = {
    "library": "Floor-Plan Studio. Open the seeded property, or upload any floor plan "
    "for AI vision ingestion.",
    "review": "The plan is a live shape object — every room and wall is selectable. "
    "The rent story: nine hundred a week baseline, twelve-sixty proposed.",
    "delta": "Delta view — a computed geometry diff. Red removed, green added, amber modified.",
    "v00": "Versions are immutable. Version zero is the original; every change is a "
    "git-style hunk with rent impact and compliance flags.",
    "select": "Select the store room, then shift-click a wall. Drag the handles to pick "
    "an exact chunk.",
    "queue": "One comment covers both targets: make it a study, and cut a servery window. "
    "Changes queue locally.",
    "send": "Send. The DeepSeek agent replies with typed, validated geometry operations — "
    "the building envelope can never grow.",
    "v04": "The new version arrives live: the study, the servery window, and a fresh "
    "rent estimate.",
    "register": "Every line in the new hunk traces to a geometry object. Export any "
    "version as a styled plan or summary.",
    "wrap": "Select, comment, send. The agent edits geometry — never pixels.",
}

_subs: list[tuple[float, str]] = []
_t0 = 0.0
_durations: dict[str, float] = {}


def _api_key() -> str:
    key = os.environ.get("DEEPGRAM_API_KEY", "")
    if key:
        return key
    env = Path(__file__).parents[1] / ".env"
    if env.exists():
        for line in env.read_text().splitlines():
            if line.startswith("DEEPGRAM_API_KEY="):
                return line.split("=", 1)[1].strip()
    return ""


def synthesize_all() -> bool:
    """Generate one mp3 per scene; returns False (silent mode) when no key."""
    key = _api_key()
    if not key:
        print("⚠ no DEEPGRAM_API_KEY — recording silent (captions only)")
        return False
    VO_DIR.mkdir(parents=True, exist_ok=True)
    for name, text in VOICEOVER.items():
        out = VO_DIR / f"{name}.mp3"
        req = urllib.request.Request(
            f"https://api.deepgram.com/v1/speak?model={TTS_MODEL}&encoding=mp3",
            data=json.dumps({"text": text}).encode(),
            headers={"Authorization": f"Token {key}", "Content-Type": "application/json"},
            method="POST",
        )
        out.write_bytes(urllib.request.urlopen(req, timeout=60).read())
        probe = subprocess.run(
            ["ffprobe", "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", out],
            capture_output=True,
            text=True,
            check=True,
        )
        _durations[name] = float(probe.stdout.strip())
        print(f"  🔊 {name}: {_durations[name]:.1f}s")
    return True


def caption(page: Page, key: str) -> None:
    text = VOICEOVER[key]
    _subs.append((time.monotonic() - _t0, text))
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


def scene_pause(page: Page, key: str, visual_ms: int) -> None:
    """Hold the scene at least as long as its spoken line (plus a beat)."""
    voiced_ms = int(_durations.get(key, 0) * 1000) + 600
    page.wait_for_timeout(max(visual_ms, voiced_ms))


def _srt_time(s: float) -> str:
    ms = int(round(s * 1000))
    return f"{ms // 3600000:02d}:{ms // 60000 % 60:02d}:{ms // 1000 % 60:02d},{ms % 1000:03d}"


def write_srt(total: float) -> Path:
    out = ART / "walkthrough.srt"
    blocks = []
    for i, (start, text) in enumerate(_subs):
        end = _subs[i + 1][0] if i + 1 < len(_subs) else total
        blocks.append(f"{i + 1}\n{_srt_time(start)} --> {_srt_time(end)}\n{text}\n")
    out.write_text("\n".join(blocks))
    return out


def mix_narration(silent_mp4: Path, out_mp4: Path) -> None:
    """Overlay each scene's clip at its measured start offset; video stream copied."""
    keys = [k for k, _ in zip(VOICEOVER, _subs)]  # scene order == caption order
    cmd: list[str] = ["ffmpeg", "-y", "-loglevel", "error", "-i", str(silent_mp4)]
    filters: list[str] = []
    for i, ((start, _), key) in enumerate(zip(_subs, keys)):
        cmd += ["-i", str(VO_DIR / f"{key}.mp3")]
        filters.append(f"[{i + 1}:a]adelay={int(start * 1000)}:all=1[a{i}]")
    mix = "".join(f"[a{i}]" for i in range(len(keys)))
    filters.append(f"{mix}amix=inputs={len(keys)}:normalize=0[aout]")
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


def shot(page: Page, name: str) -> None:
    page.screenshot(path=ART / f"{name}.png")
    print(f"  📸 {name}")


def main() -> None:
    global _t0
    ART.mkdir(exist_ok=True)
    for stale in ART.glob("*.webm"):
        stale.unlink()
    voiced = synthesize_all()

    with sync_playwright() as pw:
        browser = pw.chromium.launch()
        ctx = browser.new_context(
            viewport={"width": 1440, "height": 900},
            record_video_dir=str(ART),
            record_video_size={"width": 1440, "height": 900},
        )
        page = ctx.new_page()
        _t0 = time.monotonic()

        print("1. library")
        page.goto(BASE)
        expect(page.get_by_text("231 Peats Ferry Road, Hornsby")).to_be_visible(timeout=20000)
        caption(page, "library")
        scene_pause(page, "library", 3200)
        shot(page, "01-library")

        print("2. open review — proposed head")
        page.get_by_text("231 Peats Ferry Road, Hornsby").click()
        expect(page.locator("svg rect.room-hit").first).to_be_visible(timeout=20000)
        # fail fast if the seed isn't pristine (someone already converted the store)
        expect(page.locator('[data-room="store"]')).to_be_attached(timeout=5000)
        caption(page, "review")
        scene_pause(page, "review", 4000)
        shot(page, "02-review-proposed-v03")

        print("3. delta vs original")
        page.get_by_role("button", name="Delta vs original").click()
        caption(page, "delta")
        scene_pause(page, "delta", 4200)
        shot(page, "03-delta-vs-original")

        print("4. version history — flip back to v00 then head")
        page.get_by_role("button", name="v00", exact=True).click()
        caption(page, "v00")
        scene_pause(page, "v00", 4000)
        shot(page, "04-original-v00")
        page.locator(".versions button").last.click()  # back to head, whatever number it is
        page.get_by_role("button", name="Proposed").click()
        page.wait_for_timeout(900)

        print("5. select STORE room + wall chunk (multi-select)")
        caption(page, "select")
        page.locator('[data-room="store"]').click()
        page.wait_for_timeout(1400)
        # force: zero-height SVG lines fail Playwright's visibility heuristic but are clickable
        page.locator('[data-wall="w:kitchen-dining|living:0"]').click(
            modifiers=["Shift"], force=True
        )
        scene_pause(page, "select", 2400)
        shot(page, "05-multi-selection")

        print("6. queue the comment")
        caption(page, "queue")
        page.locator(".comment-panel textarea").fill(COMMENT)
        page.wait_for_timeout(1500)
        page.get_by_role("button", name="Add to change list").click()
        scene_pause(page, "queue", 2400)
        shot(page, "06-change-queued")

        print("7. send to agent (live DeepSeek round-trip)")
        chips_before = page.locator(".versions button").count()
        page.get_by_role("button", name="Send", exact=False).click()
        caption(page, "send")
        expect(page.get_by_text("Agent", exact=False).first).to_be_visible(timeout=10000)
        scene_pause(page, "send", 1500)
        shot(page, "07-agent-working")
        expect(page.locator(".versions button")).to_have_count(chips_before + 1, timeout=240000)
        caption(page, "v04")
        scene_pause(page, "v04", 3600)
        shot(page, "08-v04-ready")

        print("8. v04 delta + register")
        page.get_by_role("button", name="Delta vs original").click()
        page.wait_for_timeout(2200)
        shot(page, "09-v04-delta")
        caption(page, "register")
        page.locator("pre.diff").first.scroll_into_view_if_needed()
        scene_pause(page, "register", 3600)
        shot(page, "10-register")

        print("9. wrap on the stats bar")
        page.mouse.wheel(0, -2000)
        caption(page, "wrap")
        scene_pause(page, "wrap", 3200)

        total = time.monotonic() - _t0
        ctx.close()  # flushes the video
        raw = sorted(ART.glob("*.webm"), key=lambda p: p.stat().st_mtime)[-1]
        final_webm = ART / "walkthrough.webm"
        shutil.move(raw, final_webm)
        browser.close()

    srt = write_srt(total)
    print(f"subtitles: {srt}")
    print(f"video: {final_webm} ({final_webm.stat().st_size // 1024} KB)")
    if shutil.which("ffmpeg"):
        mp4 = ART / "walkthrough.mp4"
        if voiced:
            silent = ART / "_silent.mp4"
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(final_webm), str(silent)],
                check=True,
            )
            mix_narration(silent, mp4)
            silent.unlink()
            print(f"video: {mp4} ({mp4.stat().st_size // 1024} KB, narrated · {TTS_MODEL})")
        else:
            subprocess.run(
                ["ffmpeg", "-y", "-loglevel", "error", "-i", str(final_webm), str(mp4)],
                check=True,
            )
            print(f"video: {mp4} ({mp4.stat().st_size // 1024} KB, silent)")
    print("done in", time.strftime("%H:%M:%S"))


if __name__ == "__main__":
    main()
