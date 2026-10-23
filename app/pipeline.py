"""ASR -> MT -> TTS. One call turns speech in one language into speech in the other."""

import threading
import time
from dataclasses import dataclass, field

import numpy as np

from .asr import Transcriber
from .audio import ASR_SAMPLE_RATE, decode_to_pcm16k, duration_seconds, to_wav_bytes
from .config import DIRECTIONS
from .mt import Translator
from .tts import TTS_SAMPLE_RATE, Speaker


@dataclass
class Result:
    direction: str
    source_lang: str
    target_lang: str
    transcript: str
    translation: str
    audio_wav: bytes
    timings: dict[str, float] = field(default_factory=dict)

    def summary(self) -> dict:
        return {
            "direction": self.direction,
            "source_lang": self.source_lang,
            "target_lang": self.target_lang,
            "transcript": self.transcript,
            "translation": self.translation,
            "timings": self.timings,
        }


class Pipeline:
    def __init__(self) -> None:
        t0 = time.perf_counter()
        self.asr = Transcriber()
        t1 = time.perf_counter()
        self.mt = Translator()
        self.mt.check()
        t2 = time.perf_counter()
        self.tts = Speaker()
        t3 = time.perf_counter()
        self.load_timings = {"asr": t1 - t0, "mt": t2 - t1, "tts": t3 - t2}
        # Engines are not guaranteed thread-safe; serialise requests.
        self._lock = threading.Lock()

    def run(self, audio_bytes: bytes, direction: str, voice: str | None = None) -> Result:
        if direction not in DIRECTIONS:
            raise ValueError(f"direction must be one of {sorted(DIRECTIONS)}")
        src, dst = DIRECTIONS[direction]
        timings: dict[str, float] = {}

        with self._lock:
            t = time.perf_counter()
            pcm = decode_to_pcm16k(audio_bytes)
            timings["decode"] = time.perf_counter() - t
            timings["input_audio_s"] = duration_seconds(pcm, ASR_SAMPLE_RATE)

            t = time.perf_counter()
            transcript = self.asr.transcribe(pcm, language=src)
            timings["asr"] = time.perf_counter() - t

            t = time.perf_counter()
            translation = self.mt.translate(transcript, src, dst)
            timings["mt"] = time.perf_counter() - t

            t = time.perf_counter()
            samples = self.tts.synthesize(translation, lang=dst, voice_name=voice)
            timings["tts"] = time.perf_counter() - t

        timings["output_audio_s"] = duration_seconds(samples, TTS_SAMPLE_RATE)
        timings["total"] = timings["decode"] + timings["asr"] + timings["mt"] + timings["tts"]
        timings = {k: round(v, 3) for k, v in timings.items()}

        return Result(
            direction=direction,
            source_lang=src,
            target_lang=dst,
            transcript=transcript,
            translation=translation,
            audio_wav=to_wav_bytes(samples, TTS_SAMPLE_RATE),
            timings=timings,
        )

    def speak(self, text: str, lang: str) -> bytes:
        """TTS only. Used by the self-test to fabricate input audio."""
        with self._lock:
            samples = self.tts.synthesize(text, lang=lang)
        return to_wav_bytes(samples, TTS_SAMPLE_RATE)
