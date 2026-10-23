# ru-id-voice

Offline Russian <-> Indonesian voice translation prototype. Everything runs locally on CPU.

Pipeline: **Whisper** (speech to text) -> **Qwen3 4B instruct via Ollama** (translation) -> **Supertonic 3** (text to speech).

## Requirements

- Python 3.12 (3.14 has no wheels yet for the audio libs)
- ffmpeg on PATH
- Ollama running with the translation model pulled
- ~8 GB free disk for models, ~6 GB RAM while running

## Setup

macOS:

```bash
brew install ffmpeg ollama
python3.12 -m venv .venv && .venv/bin/pip install -r requirements.txt
ollama serve &            # or start the Ollama app
ollama pull qwen3:4b-instruct
```

Windows (the demo box):

```powershell
winget install Gyan.FFmpeg Ollama.Ollama Python.Python.3.12
py -3.12 -m venv .venv ; .venv\Scripts\pip install -r requirements.txt
ollama pull qwen3:4b-instruct
```

First run downloads Whisper (~500 MB for `small`, ~1.5 GB for `medium`) and Supertonic (~400 MB).

## Test without the interface

```bash
.venv/bin/python cli.py --selftest                      # synthesises test sentences, runs both directions
.venv/bin/python cli.py recording.m4a --direction ru-id  # any audio file; writes out/result.wav
```

## Run the API

```bash
.venv/bin/python -m app.server          # http://localhost:8000
```

| Method | Path | Body | Returns |
|---|---|---|---|
| GET | `/health` | | model info |
| POST | `/translate` | multipart `file` (audio), `direction` = `ru-id` or `id-ru` | JSON: `transcript`, `translation`, `audio_base64` (wav), `timings` |
| POST | `/translate/wav` | same | `audio/wav` body, text in `X-Transcript` / `X-Translation` headers |
| POST | `/tts` | form `text`, `lang` (`ru`/`id`) | `audio/wav` |

Example:

```bash
curl -F file=@out/selftest-input-ru-id.wav -F direction=ru-id http://localhost:8000/translate
```

## Run the browser interface

In a second terminal, while the API is running:

```bash
cd frontend
npm install
npm run dev
```

Open http://localhost:3000, choose Indonesian → Russian or Russian → Indonesian,
select a dubbing voice, then press the mic once and keep talking. The browser
sends what you said to `/translate` as soon as you stop talking (0.5 s of quiet).
If you talk non-stop, it also sends at the next short breath once you have spoken
for 3 s (or at 12 s at the latest), so translations keep coming. Each dubbed
translation plays as soon as it is ready, one after another. Press the mic again
to stop; any unfinished phrase is still translated. Turn on "Using headphones" to
keep the mic listening while translations play. Click the language
pill at the bottom to switch direction mid-conversation.
Set `NEXT_PUBLIC_API_URL` in `frontend/.env.local` if the API is not at
`http://localhost:8000` (see [`frontend/.env.example`](frontend/.env.example)).

## Settings (environment variables)

| Variable | Default | Notes |
|---|---|---|
| `WHISPER_MODEL` | `small` | use `medium` on the 16 GB Windows box |
| `WHISPER_COMPUTE` | `int8` | |
| `MT_MODEL` | `qwen3:4b-instruct` | must be a non-thinking model |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | |
| `TTS_VOICE_RU` / `TTS_VOICE_ID` | `M1` / `F1` | presets M1-M5, F1-F5 |
| `TTS_SPEED` | `1.0` | 0.7 to 2.0 |
| `PORT` | `8000` | |

## Known limits

- Translation is per phrase, not word by word: text appears a moment after each phrase, not while you speak.
- Without "Using headphones", the mic is paused while the dubbed audio plays so the speakers
  don't feed back into the microphone. Speech during playback is not captured.
- Requests are processed one at a time, so a long monologue can queue up a few phrases.
- Do not use the plain `qwen3:4b` tag: it is a thinking model and ignores the no-think flag, so it rambles and is 10x slower.
