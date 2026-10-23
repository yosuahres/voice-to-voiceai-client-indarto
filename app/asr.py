"""Speech to text with faster-whisper (CTranslate2, CPU int8 by default)."""

import numpy as np
from faster_whisper import WhisperModel

from .config import settings


class Transcriber:
    def __init__(self) -> None:
        self.model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute,
        )

    def transcribe(self, audio16k: np.ndarray, language: str) -> str:
        """audio16k: mono float32 at 16 kHz. language: whisper code ('ru', 'id')."""
        segments, _info = self.model.transcribe(
            audio16k,
            language=language,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        return " ".join(seg.text.strip() for seg in segments).strip()
