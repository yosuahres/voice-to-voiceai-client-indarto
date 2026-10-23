"""HTTP API for the interface.

POST /translate   multipart: file=<audio>, direction=ru-id|id-ru
                  -> JSON {transcript, translation, audio_base64 (wav), timings, ...}
POST /translate/wav  same input, returns the translated audio as audio/wav
POST /tts         form: text, lang -> audio/wav (handy for UI testing)
GET  /health
"""

import base64
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Response, UploadFile
from fastapi.middleware.cors import CORSMiddleware

from .config import DIRECTIONS, VOICES, settings
from .pipeline import Pipeline

pipeline: Pipeline | None = None


@asynccontextmanager
async def lifespan(_app: FastAPI):
    global pipeline
    pipeline = Pipeline()
    print(f"[ready] models loaded in {pipeline.load_timings}")
    yield


app = FastAPI(title="ru-id-voice", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)


def _pipe() -> Pipeline:
    if pipeline is None:
        raise HTTPException(503, "models still loading")
    return pipeline


def _run(data: bytes, direction: str, voice: str | None = None):
    if direction not in DIRECTIONS:
        raise HTTPException(400, f"direction must be one of {sorted(DIRECTIONS)}")
    if voice is not None and voice not in VOICES:
        raise HTTPException(400, f"voice must be one of {list(VOICES)}")
    if not data:
        raise HTTPException(400, "empty audio")
    try:
        return _pipe().run(data, direction, voice=voice)
    except ValueError as exc:
        raise HTTPException(400, str(exc)) from exc


@app.get("/health")
def health():
    return {
        "ok": pipeline is not None,
        "whisper": settings.whisper_model,
        "mt": settings.mt_model,
        "directions": sorted(DIRECTIONS),
    }


@app.post("/translate")
async def translate(
    file: UploadFile = File(...),
    direction: str = Form(...),
    voice: str | None = Form(None),
):
    result = _run(await file.read(), direction, voice)
    body = result.summary()
    body["audio_base64"] = base64.b64encode(result.audio_wav).decode("ascii")
    body["audio_mime"] = "audio/wav"
    return body


@app.post("/translate/wav")
async def translate_wav(file: UploadFile = File(...), direction: str = Form(...)):
    result = _run(await file.read(), direction)
    headers = {
        "X-Transcript": result.transcript.encode("utf-8").decode("latin-1", "ignore"),
        "X-Translation": result.translation.encode("utf-8").decode("latin-1", "ignore"),
    }
    return Response(content=result.audio_wav, media_type="audio/wav", headers=headers)


@app.post("/tts")
def tts(text: str = Form(...), lang: str = Form(...)):
    if lang not in ("ru", "id"):
        raise HTTPException(400, "lang must be ru or id")
    return Response(content=_pipe().speak(text, lang), media_type="audio/wav")


def main() -> None:
    import uvicorn

    uvicorn.run("app.server:app", host=settings.host, port=settings.port, reload=False)


if __name__ == "__main__":
    main()
