"""Runtime settings. Every value can be overridden with an environment variable."""

import os
from dataclasses import dataclass


@dataclass(frozen=True)
class Settings:
    # ASR (faster-whisper). "small" fits an 8 GB laptop; use "medium" on the 16 GB box.
    whisper_model: str = os.getenv("WHISPER_MODEL", "small")
    whisper_device: str = os.getenv("WHISPER_DEVICE", "cpu")
    whisper_compute: str = os.getenv("WHISPER_COMPUTE", "int8")

    # MT (Ollama)
    ollama_url: str = os.getenv("OLLAMA_URL", "http://127.0.0.1:11434")
    mt_model: str = os.getenv("MT_MODEL", "qwen3:4b-instruct")
    mt_timeout_s: float = float(os.getenv("MT_TIMEOUT_S", "120"))

    # TTS (Supertonic 3). Presets: M1-M5, F1-F5.
    tts_voice_ru: str = os.getenv("TTS_VOICE_RU", "M1")
    tts_voice_id: str = os.getenv("TTS_VOICE_ID", "F1")
    tts_steps: int = int(os.getenv("TTS_STEPS", "8"))
    tts_speed: float = float(os.getenv("TTS_SPEED", "1.0"))

    # YouTube: longer videos are refused. CPU translation runs at roughly real time or slower.
    youtube_max_minutes: float = float(os.getenv("YOUTUBE_MAX_MINUTES", "30"))

    # Server
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))


settings = Settings()

LANG_NAMES = {"ru": "Russian", "id": "Indonesian"}

DIRECTIONS = {
    "ru-id": ("ru", "id"),
    "id-ru": ("id", "ru"),
}

VOICES = tuple(f"{gender}{number}" for gender in ("M", "F") for number in range(1, 6))
