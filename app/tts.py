"""Text to speech with Supertonic 3 (ONNX, CPU)."""

import numpy as np
from supertonic import TTS

from .config import settings

TTS_SAMPLE_RATE = 44_100


class Speaker:
    def __init__(self) -> None:
        self.tts = TTS(auto_download=True)
        self._styles: dict[str, object] = {}

    def _style(self, voice_name: str):
        if voice_name not in self._styles:
            self._styles[voice_name] = self.tts.get_voice_style(voice_name=voice_name)
        return self._styles[voice_name]

    def voice_for(self, lang: str) -> str:
        return settings.tts_voice_ru if lang == "ru" else settings.tts_voice_id

    def synthesize(self, text: str, lang: str, voice_name: str | None = None) -> np.ndarray:
        """Return mono float32 samples at 44.1 kHz."""
        if not text.strip():
            return np.zeros(0, dtype=np.float32)
        wav, _duration = self.tts.synthesize(
            text,
            voice_style=self._style(voice_name or self.voice_for(lang)),
            total_steps=settings.tts_steps,
            speed=settings.tts_speed,
            lang=lang,
        )
        arr = np.asarray(wav)
        if arr.ndim > 1:
            arr = arr.reshape(-1)
        if arr.dtype == np.int16:
            arr = arr.astype(np.float32) / 32768.0
        return arr.astype(np.float32)
