"""Fetch the audio track of a YouTube video with yt-dlp."""

import shutil
import tempfile
from dataclasses import dataclass
from pathlib import Path

import numpy as np
import yt_dlp

from .audio import decode_file_to_pcm16k


@dataclass
class Video:
    title: str
    duration_s: float
    pcm: np.ndarray  # mono float32 at 16 kHz


def _options(folder: str) -> dict:
    return {
        "format": "bestaudio/best",
        "outtmpl": f"{folder}/audio.%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "noprogress": True,
        # YouTube now needs a JavaScript runtime to unlock most formats; use whichever is installed.
        "js_runtimes": {name: {} for name in ("deno", "node", "bun") if shutil.which(name)},
    }


def download_audio(url: str, max_duration_s: float) -> Video:
    """Download and decode the audio. Raises ValueError for bad links or videos that are too long."""
    with tempfile.TemporaryDirectory() as folder:
        try:
            with yt_dlp.YoutubeDL(_options(folder)) as ydl:
                info = ydl.extract_info(url, download=False)
                if info.get("_type") == "playlist":
                    raise ValueError("Paste a link to a single video, not a playlist.")
                duration = float(info.get("duration") or 0)
                if info.get("is_live"):
                    raise ValueError("Live streams are not supported.")
                if duration > max_duration_s:
                    raise ValueError(
                        f"Video is {duration / 60:.0f} min long; the limit is {max_duration_s / 60:.0f} min."
                    )
                info = ydl.process_ie_result(info, download=True)
        except yt_dlp.utils.DownloadError as exc:
            message = str(exc).removeprefix("ERROR: ")
            raise ValueError(f"Could not download the video: {message}") from exc

        path = Path(info["requested_downloads"][0]["filepath"])
        return Video(title=info.get("title") or "", duration_s=duration, pcm=decode_file_to_pcm16k(path))
