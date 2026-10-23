"use client";

import { useEffect, useRef, useState } from "react";
import { startPhraseRecorder, type PhraseRecorder } from "./phrase-recorder";

type Direction = "id-ru" | "ru-id";
type Language = "Indonesian" | "Russian";
type Entry = {
  id: number;
  source: Language;
  sourceText: string;
  translatedText: string;
  audio: AudioBuffer | null;
  pending: boolean;
};

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
// ngrok's free plan serves a browser warning page instead of the API unless this header is sent.
const API_HEADERS = { "ngrok-skip-browser-warning": "1" };
const languages: Language[] = ["Indonesian", "Russian"];
const voices = ["M1", "M2", "M3", "M4", "M5", "F1", "F2", "F3", "F4", "F5"];
const MIC_RESUME_DELAY_MS = 300;

function bytesFromBase64(base64: string): ArrayBuffer {
  return Uint8Array.from(atob(base64), (char) => char.charCodeAt(0)).buffer;
}

function voiceLabel(voice: string): string {
  return `${voice.startsWith("M") ? "Male" : "Female"} ${voice.slice(1)}`;
}

function sourceOf(direction: Direction): Language {
  return direction === "id-ru" ? "Indonesian" : "Russian";
}

function textIn(entry: Entry, language: Language): string {
  return entry.source === language ? entry.sourceText : entry.translatedText;
}

function VoiceAvatar({ voice }: { voice: string }) {
  return <span className={`avatar ${voice.startsWith("M") ? "male" : "female"}`}>{voice}</span>;
}

function Logo({ className = "" }: { className?: string }) {
  return <span className={`logo ${className}`} role="img" aria-label="Databiota" />;
}

function Icon({ path, className = "icon" }: { path: string; className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true">
      <path d={path} />
    </svg>
  );
}

const icons = {
  chevron: "m6 9 6 6 6-6",
  swap: "M17 3l3 3-3 3M20 6H8M7 21l-3-3 3-3M4 18h12",
  copy: "M8 8h11v11H8zM16 8V5H5v11h3",
  back: "M19 12H5m6-6-6 6 6 6",
  download: "M12 4v11m-5-5 5 5 5-5M5 20h14",
  arrow: "M5 12h14m-5-5 5 5-5 5",
  speaker: "M4 9v6h4l5 4V5L8 9zm12.5-.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12",
  expand: "M14 4h6v6M20 4l-7 7M10 20H4v-6M4 20l7-7",
  collapse: "M20 10h-6V4M14 10l7-7M4 14h6v6M10 14l-7 7",
};

function MicIcon({ listening }: { listening: boolean }) {
  if (listening) return <span className="stop-icon" aria-hidden="true" />;
  return (
    <svg className="mic-icon" viewBox="0 0 24 24" aria-hidden="true">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21M8.5 21h7" />
    </svg>
  );
}

function PendingLine() {
  return (
    <p className="line pending" aria-label="Translating">
      <span className="typing"><i /><i /><i /></span>
    </p>
  );
}

export default function Home() {
  const [direction, setDirection] = useState<Direction>("id-ru");
  const [voice, setVoice] = useState("M1");
  const [voiceMenuOpen, setVoiceMenuOpen] = useState(false);
  const [headphones, setHeadphones] = useState(false);
  const [listening, setListening] = useState(false);
  const [speaking, setSpeaking] = useState(false);
  const [playing, setPlaying] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [error, setError] = useState("");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [columns, setColumns] = useState<[Language, Language] | null>(null);
  const [fullscreen, setFullscreen] = useState(false);
  const voicePicker = useRef<HTMLDivElement | null>(null);
  const panels = useRef<(HTMLDivElement | null)[]>([]);
  const recorder = useRef<PhraseRecorder | null>(null);
  const starting = useRef(false);
  const settings = useRef({ direction, voice, headphones });
  const requests = useRef<Promise<void>>(Promise.resolve());
  const session = useRef(0);
  const nextId = useRef(0);
  const output = useRef<AudioContext | null>(null);
  const playlist = useRef<AudioBuffer[]>([]);
  const player = useRef<AudioBufferSourceNode | null>(null);
  const micResume = useRef<number | undefined>(undefined);

  const sourceLanguage = sourceOf(direction);
  const targetLanguage: Language = sourceLanguage === "Indonesian" ? "Russian" : "Indonesian";
  const finished = entries.filter((entry) => !entry.pending);
  const latestAudio = finished.findLast((entry) => entry.audio)?.audio;
  const status = error
    ? error
    : playing && (!headphones || !listening)
      ? listening
        ? "Playing translation… mic paused"
        : "Playing translation…"
      : listening
        ? speaking
          ? "Hearing you…"
          : pendingCount
            ? "Translating…"
            : "Listening…"
        : pendingCount
          ? "Translating…"
          : "Press and start talking";

  useEffect(() => {
    settings.current = { direction, voice, headphones };
  }, [direction, voice, headphones]);

  useEffect(() => {
    if (!voiceMenuOpen) return;
    function close(event: PointerEvent) {
      if (!voicePicker.current?.contains(event.target as Node)) setVoiceMenuOpen(false);
    }
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, [voiceMenuOpen]);

  useEffect(() => {
    panels.current.forEach((panel) => panel?.scrollTo({ top: panel.scrollHeight, behavior: "smooth" }));
  }, [entries]);

  useEffect(() => {
    function sync() {
      setFullscreen(Boolean(document.fullscreenElement));
    }
    document.addEventListener("fullscreenchange", sync);
    return () => document.removeEventListener("fullscreenchange", sync);
  }, []);

  useEffect(
    () => () => {
      recorder.current?.stop(false);
      window.clearTimeout(micResume.current);
      void output.current?.close();
    },
    [],
  );

  function swapLanguages() {
    setDirection((value) => (value === "id-ru" ? "ru-id" : "id-ru"));
  }

  function chooseSource(language: Language) {
    setDirection(language === "Indonesian" ? "id-ru" : "ru-id");
  }

  function chooseTarget(language: Language) {
    setDirection(language === "Russian" ? "id-ru" : "ru-id");
  }

  // Safari only lets a page make sound from a context started by a click, so this runs on every mic press.
  function unlockAudio() {
    output.current ??= new AudioContext();
    void output.current.resume();
  }

  async function decodeSpeech(base64: string): Promise<AudioBuffer | null> {
    output.current ??= new AudioContext();
    try {
      return await output.current.decodeAudioData(bytesFromBase64(base64));
    } catch {
      return null;
    }
  }

  // Through speakers the dubbed audio would leak back into the microphone, so the mic is
  // paused while it plays. With headphones it stays on.
  function playNext() {
    const buffer = playlist.current.shift();
    const context = output.current;
    if (!buffer || !context) {
      player.current = null;
      setPlaying(false);
      micResume.current = window.setTimeout(() => recorder.current?.setPaused(false), MIC_RESUME_DELAY_MS);
      return;
    }
    const node = context.createBufferSource();
    node.buffer = buffer;
    node.connect(context.destination);
    node.onended = () => {
      if (player.current === node) playNext();
    };
    player.current = node;
    window.clearTimeout(micResume.current);
    if (!settings.current.headphones) recorder.current?.setPaused(true);
    setPlaying(true);
    node.start();
  }

  function enqueuePlayback(buffer: AudioBuffer) {
    playlist.current.push(buffer);
    if (!player.current) playNext();
  }

  function stopCurrentClip() {
    const node = player.current;
    player.current = null;
    node?.stop();
  }

  function replay(buffer: AudioBuffer) {
    unlockAudio();
    stopCurrentClip();
    playlist.current = [buffer];
    playNext();
  }

  function stopPlayback() {
    window.clearTimeout(micResume.current);
    playlist.current = [];
    stopCurrentClip();
    setPlaying(false);
  }

  function updateEntry(id: number, changes: Partial<Entry>) {
    setEntries((current) => current.map((entry) => (entry.id === id ? { ...entry, ...changes } : entry)));
  }

  function removeEntry(id: number) {
    setEntries((current) => current.filter((entry) => entry.id !== id));
  }

  function handlePhrase(wav: Blob) {
    const { direction: phraseDirection, voice: phraseVoice } = settings.current;
    const id = nextId.current++;
    const sessionId = session.current;
    setEntries((current) => [
      ...current,
      { id, source: sourceOf(phraseDirection), sourceText: "", translatedText: "", audio: null, pending: true },
    ]);
    setPendingCount((count) => count + 1);
    requests.current = requests.current.then(() =>
      translatePhrase(wav, phraseDirection, phraseVoice, id, sessionId),
    );
  }

  async function translatePhrase(wav: Blob, phraseDirection: Direction, phraseVoice: string, id: number, sessionId: number) {
    try {
      const form = new FormData();
      form.append("file", wav, "phrase.wav");
      form.append("direction", phraseDirection);
      form.append("voice", phraseVoice);
      const response = await fetch(`${API_URL}/translate`, { method: "POST", headers: API_HEADERS, body: form });
      if (!response.ok) throw new Error((await response.text()) || `Translation failed (${response.status})`);
      const result = (await response.json()) as {
        transcript: string;
        translation: string;
        audio_base64: string;
      };
      if (sessionId !== session.current) return;
      if (!result.transcript.trim()) {
        removeEntry(id);
        return;
      }
      const audio = await decodeSpeech(result.audio_base64);
      if (sessionId !== session.current) return;
      updateEntry(id, { sourceText: result.transcript, translatedText: result.translation, audio, pending: false });
      if (audio) enqueuePlayback(audio);
    } catch (cause) {
      if (sessionId !== session.current) return;
      removeEntry(id);
      setError(cause instanceof Error ? cause.message : "Translation failed.");
    } finally {
      if (sessionId === session.current) setPendingCount((count) => count - 1);
    }
  }

  async function startListening() {
    if (recorder.current || starting.current) return;
    starting.current = true;
    setError("");
    setVoiceMenuOpen(false);
    try {
      recorder.current = await startPhraseRecorder({ onPhrase: handlePhrase, onSpeech: setSpeaking });
      if (player.current && !settings.current.headphones) recorder.current.setPaused(true);
      setListening(true);
      setColumns((current) => current ?? [sourceLanguage, targetLanguage]);
    } catch (cause) {
      setError(
        cause instanceof DOMException && cause.name === "NotAllowedError"
          ? "Microphone permission is required."
          : "Could not start the microphone.",
      );
    } finally {
      starting.current = false;
    }
  }

  function stopListening(flush = true) {
    recorder.current?.stop(flush);
    recorder.current = null;
    setListening(false);
  }

  function toggleListening() {
    unlockAudio();
    if (recorder.current) stopListening();
    else void startListening();
  }

  function endSession() {
    stopPlayback();
    stopListening(false);
    session.current++;
    requests.current = Promise.resolve();
    setEntries([]);
    setColumns(null);
    setPendingCount(0);
    setError("");
  }

  function downloadTranscript() {
    if (!columns) return;
    const text = finished
      .map((entry) => columns.map((language) => `${language}: ${textIn(entry, language)}`).join("\n"))
      .join("\n\n");
    const link = document.createElement("a");
    link.href = URL.createObjectURL(new Blob([text], { type: "text/plain;charset=utf-8" }));
    link.download = "transcript.txt";
    link.click();
    URL.revokeObjectURL(link.href);
  }

  function toggleFullscreen() {
    if (document.fullscreenElement) void document.exitFullscreen();
    else void document.documentElement.requestFullscreen();
  }

  const micClass = `microphone ${listening ? "listening" : ""} ${speaking ? "speaking" : ""}`;
  const micLabel = listening ? "Stop listening" : "Start listening";

  if (columns) {
    return (
      <main className="session">
        <div className="columns">
          {columns.map((language, index) => (
            <section className="column" key={language} aria-label={language}>
              <button
                className="icon-button copy"
                aria-label={`Copy ${language} text`}
                title="Copy"
                onClick={() => void navigator.clipboard.writeText(finished.map((entry) => textIn(entry, language)).join("\n"))}
              >
                <Icon path={icons.copy} />
              </button>
              <div className="lines" ref={(element) => { panels.current[index] = element; }} aria-live="polite">
                <div className="lines-inner">
                  {entries.map((entry) =>
                    entry.pending ? (
                      <PendingLine key={entry.id} />
                    ) : entry.source === language ? (
                      <p className="line" key={entry.id}>{entry.sourceText}</p>
                    ) : (
                      <button className="line playable" key={entry.id} title="Play again" onClick={() => entry.audio && replay(entry.audio)}>
                        {entry.translatedText}
                      </button>
                    ),
                  )}
                </div>
              </div>
            </section>
          ))}
        </div>

        <div className="session-actions">
          <button className="pill-button danger" onClick={endSession}>
            <Icon path={icons.back} />
            Go Back
          </button>
          <button className={`${micClass} small`} onClick={toggleListening} aria-label={micLabel} aria-pressed={listening}>
            <MicIcon listening={listening} />
          </button>
          <button className="pill-button outline" onClick={downloadTranscript} disabled={!finished.length}>
            <Icon path={icons.download} />
            Download
          </button>
          <button
            className="icon-button round expand"
            aria-label={fullscreen ? "Exit full screen" : "Full screen"}
            onClick={toggleFullscreen}
          >
            <Icon path={fullscreen ? icons.collapse : icons.expand} />
          </button>
        </div>

        <footer className="session-footer">
          <Logo className="footer-logo" />
          <p className={`status ${error ? "failed" : listening ? "live" : ""}`}>{status}</p>
          <div className="direction-pill">
            <button className="direction" onClick={swapLanguages} title="Switch languages">
              {sourceLanguage}
              <Icon path={icons.arrow} />
              {targetLanguage}
            </button>
            <button
              className="icon-button speaker"
              aria-label="Play last translation"
              disabled={!latestAudio}
              onClick={() => latestAudio && replay(latestAudio)}
            >
              <Icon path={icons.speaker} />
            </button>
          </div>
        </footer>
      </main>
    );
  }

  return (
    <main className="page">
      <div className="card">
        <Logo className="card-logo" />
        <section className="translator">
          <h1>Live Translate</h1>
          <p className="subtitle">Speak in one language and hear it dubbed in the other.</p>

          <div className="language-row">
            <label className="select-pill">
              <select
                aria-label="Source language"
                value={sourceLanguage}
                onChange={(event) => chooseSource(event.target.value as Language)}
              >
                {languages.map((language) => <option key={language}>{language}</option>)}
              </select>
              <Icon path={icons.chevron} className="chevron" />
            </label>
            <button className="swap" aria-label="Switch languages" onClick={swapLanguages}>
              <Icon path={icons.swap} />
            </button>
            <label className="select-pill">
              <select
                aria-label="Target language"
                value={targetLanguage}
                onChange={(event) => chooseTarget(event.target.value as Language)}
              >
                {languages.map((language) => <option key={language}>{language}</option>)}
              </select>
              <Icon path={icons.chevron} className="chevron" />
            </label>
          </div>

          <div className="voice-row">
            <span>Select a voice</span>
            <div className="voice-picker" ref={voicePicker}>
              <button
                className="voice-button"
                aria-haspopup="listbox"
                aria-expanded={voiceMenuOpen}
                onClick={() => setVoiceMenuOpen((open) => !open)}
              >
                <VoiceAvatar voice={voice} />
                {voiceLabel(voice)}
              </button>
              {voiceMenuOpen && (
                <ul className="voice-menu" role="listbox" aria-label="Dubbing voice">
                  {voices.map((option) => (
                    <li key={option}>
                      <button
                        role="option"
                        aria-selected={option === voice}
                        onClick={() => {
                          setVoice(option);
                          setVoiceMenuOpen(false);
                        }}
                      >
                        <VoiceAvatar voice={option} />
                        {voiceLabel(option)}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="toggle-row">
            <span>
              Using headphones
              <small>Keeps the mic on while the translation plays</small>
            </span>
            <button
              className="switch"
              role="switch"
              aria-checked={headphones}
              aria-label="Using headphones"
              onClick={() => setHeadphones((value) => !value)}
            />
          </div>

          <div className="talk">
            <p className="hint">Press and start talking</p>
            <button className={micClass} onClick={toggleListening} aria-label={micLabel} aria-pressed={listening}>
              <MicIcon listening={listening} />
            </button>
          </div>
          {error && <p className="error">{error}</p>}
        </section>
      </div>
    </main>
  );
}
