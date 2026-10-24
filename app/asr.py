"""Speech to text with faster-whisper (CTranslate2, CPU int8 by default)."""

from collections.abc import Iterable, Iterator
from dataclasses import replace

import numpy as np
from faster_whisper import WhisperModel
from faster_whisper.transcribe import Segment
from faster_whisper.vad import VadOptions, get_speech_timestamps

from .audio import ASR_SAMPLE_RATE
from .config import settings

# Whisper prepares the whole input before returning its first segment, so long recordings are
# transcribed in chunks of about this many seconds, cut at pauses.
CHUNK_S = 60
SENTENCE_END = (".", "!", "?", "…")
# Long recordings are cut into phrases: at a sentence end once this many seconds are collected...
PHRASE_MIN_S = 4.0
# ...or anywhere once this many are, so text keeps flowing when whisper leaves out punctuation.
PHRASE_MAX_S = 15.0


class Transcriber:
    def __init__(self) -> None:
        self.model = WhisperModel(
            settings.whisper_model,
            device=settings.whisper_device,
            compute_type=settings.whisper_compute,
        )

    def segments(self, audio16k: np.ndarray, language: str) -> Iterator[Segment]:
        """audio16k: mono float32 at 16 kHz. language: whisper code ('ru', 'id').
        Segments are decoded lazily, so the first ones arrive long before a long recording is done."""
        segments, _info = self.model.transcribe(
            audio16k,
            language=language,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        return segments

    def long_segments(self, audio16k: np.ndarray, language: str) -> Iterator[Segment]:
        """Same as segments, but the first ones arrive within seconds however long the recording is."""
        for start, end in _speech_chunks(audio16k):
            offset = start / ASR_SAMPLE_RATE
            for seg in self.segments(audio16k[start:end], language):
                yield replace(seg, start=seg.start + offset, end=seg.end + offset)

    def transcribe(self, audio16k: np.ndarray, language: str) -> str:
        return " ".join(seg.text.strip() for seg in self.segments(audio16k, language)).strip()


def _speech_chunks(audio16k: np.ndarray) -> Iterator[tuple[int, int]]:
    """Sample ranges of at most about CHUNK_S seconds that start and end in a pause."""
    limit = CHUNK_S * ASR_SAMPLE_RATE
    chunk: tuple[int, int] | None = None
    for span in get_speech_timestamps(audio16k, VadOptions(max_speech_duration_s=CHUNK_S)):
        if chunk and span["end"] - chunk[0] > limit:
            yield chunk
            chunk = None
        chunk = (chunk[0] if chunk else span["start"], span["end"])
    if chunk:
        yield chunk


def phrases(segments: Iterable[Segment]) -> Iterator[str]:
    """Join whisper segments into phrases short enough to translate and dub one at a time."""
    texts: list[str] = []
    start = 0.0
    for seg in segments:
        text = seg.text.strip()
        if not text:
            continue
        if not texts:
            start = seg.start
        texts.append(text)
        length = seg.end - start
        if length >= PHRASE_MAX_S or (length >= PHRASE_MIN_S and text.endswith(SENTENCE_END)):
            yield " ".join(texts)
            texts = []
    if texts:
        yield " ".join(texts)
