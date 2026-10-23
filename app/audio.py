"""Audio conversion helpers. ffmpeg does all decoding so any browser format works."""

import io
import shutil
import subprocess
import wave

import numpy as np

ASR_SAMPLE_RATE = 16_000


def ensure_ffmpeg() -> None:
    if shutil.which("ffmpeg") is None:
        raise RuntimeError("ffmpeg not found on PATH. Install it (brew install ffmpeg / winget install ffmpeg).")


def decode_to_pcm16k(data: bytes) -> np.ndarray:
    """Decode any audio container (wav, webm, ogg, m4a, mp3) to mono float32 at 16 kHz."""
    ensure_ffmpeg()
    proc = subprocess.run(
        [
            "ffmpeg", "-hide_banner", "-loglevel", "error",
            "-i", "pipe:0",
            "-f", "s16le", "-acodec", "pcm_s16le", "-ac", "1", "-ar", str(ASR_SAMPLE_RATE),
            "pipe:1",
        ],
        input=data,
        capture_output=True,
    )
    if proc.returncode != 0:
        raise ValueError(f"ffmpeg could not decode audio: {proc.stderr.decode(errors='ignore').strip()}")
    pcm = np.frombuffer(proc.stdout, dtype=np.int16)
    return pcm.astype(np.float32) / 32768.0


def to_wav_bytes(samples: np.ndarray, sample_rate: int) -> bytes:
    """Encode a float32 (-1..1) or int16 mono array as a 16-bit PCM WAV."""
    arr = np.asarray(samples)
    if arr.ndim > 1:
        arr = arr.reshape(-1)
    if arr.dtype != np.int16:
        arr = np.clip(arr.astype(np.float32), -1.0, 1.0)
        arr = (arr * 32767.0).astype(np.int16)
    buf = io.BytesIO()
    with wave.open(buf, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(arr.tobytes())
    return buf.getvalue()


def duration_seconds(samples: np.ndarray, sample_rate: int) -> float:
    return float(len(samples)) / sample_rate
