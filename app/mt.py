"""Text translation through a local Ollama model."""

import re

import httpx

from .config import LANG_NAMES, settings

_THINK_RE = re.compile(r"<think>.*?</think>", re.DOTALL)


class Translator:
    def __init__(self) -> None:
        self.client = httpx.Client(base_url=settings.ollama_url, timeout=settings.mt_timeout_s)

    def check(self) -> None:
        """Raise a clear error if Ollama is down or the model is missing."""
        try:
            tags = self.client.get("/api/tags").json()
        except httpx.HTTPError as exc:
            raise RuntimeError(f"Ollama not reachable at {settings.ollama_url}: {exc}") from exc
        names = {m.get("name", "") for m in tags.get("models", [])}
        wanted = settings.mt_model if ":" in settings.mt_model else f"{settings.mt_model}:latest"
        if wanted not in names:
            raise RuntimeError(f"Model {settings.mt_model!r} not pulled. Run: ollama pull {settings.mt_model}")

    def translate(self, text: str, src: str, dst: str) -> str:
        if not text.strip():
            return ""
        system = (
            f"You are a professional {LANG_NAMES[src]} to {LANG_NAMES[dst]} interpreter. "
            f"Translate the user's message from {LANG_NAMES[src]} into natural spoken {LANG_NAMES[dst]}. "
            "Output ONLY the translation. No explanations, no quotes, no notes, no alternatives. "
            "Keep names, numbers and places unchanged. If the input is already in the target language, repeat it unchanged."
        )
        payload = {
            "model": settings.mt_model,
            "stream": False,
            "think": False,
            "options": {"temperature": 0.0, "num_predict": 256},
            "messages": [
                {"role": "system", "content": system},
                {"role": "user", "content": text.strip()},
            ],
        }
        resp = self.client.post("/api/chat", json=payload)
        resp.raise_for_status()
        content = resp.json().get("message", {}).get("content", "")
        return _clean(content)


def _clean(content: str) -> str:
    content = _THINK_RE.sub("", content).strip()
    # Take only the first paragraph; models sometimes append commentary after a blank line.
    content = content.split("\n\n", 1)[0].strip()
    return content.strip('"“”«» ')
