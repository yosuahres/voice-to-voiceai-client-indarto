# Deploy: API on Windows, frontend on Vercel

The frontend runs on Vercel. The Python API runs on a Windows PC and is reached
through a Cloudflare quick tunnel, which gives it a public HTTPS address.

```
Browser ──> Vercel (frontend) ──> https://xxxx.trycloudflare.com ──> Windows PC :8000 (API)
```

## A. One-time setup (Windows PowerShell)

Install the tools:

```powershell
winget install Python.Python.3.12 Gyan.FFmpeg Ollama.Ollama Git.Git Cloudflare.cloudflared DenoLand.Deno
```

Deno is only used to download YouTube videos (YouTube needs a JavaScript runtime).

**Close PowerShell and open a new one** so the new tools are on PATH. Then:

```powershell
cd $HOME
git clone https://github.com/yosuahres/voice-to-voiceai-client-indarto.git
cd voice-to-voiceai-client-indarto
py -3.12 -m venv .venv
.venv\Scripts\pip install -r requirements.txt
ollama pull qwen3:4b-instruct
```

To get updates later:

```powershell
cd $HOME\voice-to-voiceai-client-indarto
git pull
.venv\Scripts\pip install -r requirements.txt
```

## B. Every time you run it

### 1. Start Ollama

Open the **Ollama** app from the Start menu. It runs in the system tray.

### 2. Start the API (PowerShell window 1)

```powershell
cd $HOME\voice-to-voiceai-client-indarto
$env:WHISPER_MODEL = "small"
.venv\Scripts\python -m app.server
```

Wait until it prints `[ready] models loaded`. The first run downloads about 1 GB
of models and takes a few minutes.

Check it: open http://localhost:8000/health on the PC.

### 3. Start the tunnel (PowerShell window 2)

```powershell
cloudflared tunnel --url http://localhost:8000
```

It prints a URL like `https://some-random-words.trycloudflare.com`. Copy it.

Check it: open `<tunnel URL>/health` in a browser.

**Keep both PowerShell windows open.** The URL is new every time you start the
tunnel, so do step C again after each restart.

## C. Point Vercel at the tunnel (every time the URL changes)

1. Vercel project → **Settings → Environment Variables**.
2. Add or edit:
   - **Key:** `NEXT_PUBLIC_API_URL`
   - **Value:** the tunnel URL, e.g. `https://some-random-words.trycloudflare.com`
     (no trailing `/`)
   - **Environments:** Production (and Preview if you use preview links)
3. **Deployments** → **⋯** on the latest deployment → **Redeploy**, with
   **Use existing Build Cache** unticked.
4. Open the site, press the mic and allow microphone access.

The redeploy is required: Vercel builds the API address into the site, so a
changed variable has no effect until the next build.

## Tips

- **Whisper model:** `small` is faster. `medium` is more accurate with accents and
  noise but roughly twice as slow. To try it, use `$env:WHISPER_MODEL = "medium"`
  in step 2.
- **Speed check:** `.venv\Scripts\python cli.py --selftest` runs both directions
  and prints `timings.total`, the seconds one phrase takes.
- **Before a demo:** close heavy apps and browser tabs, set
  **Settings → System → Power → Best performance**, and turn off sleep.
- **One user at a time:** the API processes requests one after another.
- **Keep the tunnel URL private:** anyone who has it can use the API.

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| Site says "Translation failed" | A PowerShell window was closed or the PC slept. Check `<tunnel URL>/health`; if the URL changed, redo step C. |
| `/health` works locally but not through the tunnel | The tunnel window was closed. Restart step 3 and redo step C. |
| `Ollama not reachable` when starting the API | The Ollama app isn't running. Open it and start the API again. |
| `Model 'qwen3:4b-instruct' not pulled` | Run `ollama pull qwen3:4b-instruct`. |
| `ffmpeg not found on PATH` | Open a new PowerShell window after installing, or reinstall with `winget install Gyan.FFmpeg`. |
| Error 524 from Cloudflare | One request took over 100 s. Use `WHISPER_MODEL=small` and close other apps. |
| YouTube says "Could not download the video" | YouTube changes often. Update the downloader: `.venv\Scripts\pip install -U "yt-dlp[default]"`, then restart the API. |
| Mic button does nothing | Allow microphone access for the site in the browser's address bar. |
