// Listens to the microphone continuously and hands back one WAV per spoken phrase.
// A phrase ends as soon as the speaker goes quiet, or at a short breath once it is long enough,
// so translation keeps flowing without the speaker having to pause on purpose.

export type PhraseRecorder = {
  setPaused: (paused: boolean) => void;
  stop: (flush?: boolean) => void;
};

type Events = {
  onPhrase: (wav: Blob) => void;
  /** true while the speaker is talking; false once they have been quiet for IDLE_S */
  onSpeech: (speaking: boolean) => void;
};

const OUTPUT_RATE = 16_000;
const PREROLL_S = 0.35; // keep the start of the first word
const END_SILENCE_S = 0.5; // the speaker stopped talking
const SOFT_MAX_S = 3; // past this, also cut at a short breath
const BREATH_S = 0.25;
const HARD_MAX_S = 12;
const IDLE_S = 0.8; // quiet long enough to play the dubbed audio
const MIN_SPEECH_S = 0.3; // shorter bursts are clicks and coughs
const MIN_LEVEL = 0.012;
const MAX_NOISE_FLOOR = 0.02;

const workletSource = `
class PhraseTap extends AudioWorkletProcessor {
  constructor() {
    super();
    this.buffer = new Float32Array(2048);
    this.size = 0;
  }
  process(inputs) {
    const channel = inputs[0][0];
    if (channel) {
      for (let i = 0; i < channel.length; i++) {
        this.buffer[this.size++] = channel[i];
        if (this.size === this.buffer.length) {
          this.port.postMessage(this.buffer);
          this.buffer = new Float32Array(2048);
          this.size = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor("phrase-tap", PhraseTap);
`;

export async function startPhraseRecorder(events: Events): Promise<PhraseRecorder> {
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true },
  });
  const context = new AudioContext();
  try {
    const moduleUrl = URL.createObjectURL(new Blob([workletSource], { type: "application/javascript" }));
    await context.audioWorklet.addModule(moduleUrl);
    URL.revokeObjectURL(moduleUrl);
  } catch (cause) {
    stream.getTracks().forEach((track) => track.stop());
    void context.close();
    throw cause;
  }

  const source = context.createMediaStreamSource(stream);
  const tap = new AudioWorkletNode(context, "phrase-tap");
  source.connect(tap);
  tap.connect(context.destination);

  const rate = context.sampleRate;
  let preroll: Float32Array[] = [];
  let prerollLength = 0;
  let phrase: Float32Array[] | null = null;
  let phraseLength = 0;
  let voicedLength = 0;
  let silentLength = 0;
  let quietLength = 0;
  let noiseFloor = 0.004;
  let speaking = false;
  let paused = false;

  function setSpeaking(value: boolean) {
    if (speaking === value) return;
    speaking = value;
    events.onSpeech(value);
  }

  function finishPhrase(emit: boolean) {
    if (emit && phrase && voicedLength >= MIN_SPEECH_S * rate) {
      events.onPhrase(encodeWav(downsample(concat(phrase, phraseLength), rate)));
    }
    phrase = null;
    phraseLength = voicedLength = silentLength = 0;
  }

  function reset() {
    finishPhrase(false);
    preroll = [];
    prerollLength = 0;
    quietLength = 0;
    setSpeaking(false);
  }

  tap.port.onmessage = (event: MessageEvent<Float32Array>) => {
    if (paused) return;
    const chunk = event.data;
    const level = rms(chunk);
    const voiced = level > Math.max(MIN_LEVEL, noiseFloor * 3);
    if (voiced) {
      quietLength = 0;
      setSpeaking(true);
    } else {
      noiseFloor = Math.min(MAX_NOISE_FLOOR, noiseFloor * 0.95 + level * 0.05);
      quietLength += chunk.length;
      if (quietLength >= IDLE_S * rate) setSpeaking(false);
    }

    if (!phrase) {
      if (!voiced) {
        preroll.push(chunk);
        prerollLength += chunk.length;
        while (preroll.length && prerollLength - preroll[0].length >= PREROLL_S * rate) {
          prerollLength -= preroll.shift()!.length;
        }
        return;
      }
      phrase = preroll;
      phraseLength = prerollLength;
      preroll = [];
      prerollLength = 0;
    }

    phrase.push(chunk);
    phraseLength += chunk.length;
    if (voiced) {
      voicedLength += chunk.length;
      silentLength = 0;
    } else {
      silentLength += chunk.length;
    }

    if (
      silentLength >= END_SILENCE_S * rate ||
      (phraseLength >= SOFT_MAX_S * rate && silentLength >= BREATH_S * rate) ||
      phraseLength >= HARD_MAX_S * rate
    ) {
      finishPhrase(true);
    }
  };

  return {
    setPaused(value) {
      if (value === paused) return;
      if (value) {
        finishPhrase(true);
        reset();
      }
      paused = value;
    },
    stop(flush = true) {
      finishPhrase(flush && !paused);
      reset();
      paused = true;
      tap.port.onmessage = null;
      source.disconnect();
      tap.disconnect();
      stream.getTracks().forEach((track) => track.stop());
      void context.close();
    },
  };
}

function rms(samples: Float32Array): number {
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

function concat(chunks: Float32Array[], length: number): Float32Array {
  const out = new Float32Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function downsample(samples: Float32Array, rate: number): Float32Array {
  if (rate === OUTPUT_RATE) return samples;
  const ratio = rate / OUTPUT_RATE;
  const out = new Float32Array(Math.floor(samples.length / ratio));
  for (let i = 0; i < out.length; i++) {
    const start = Math.floor(i * ratio);
    const end = Math.min(samples.length, Math.floor((i + 1) * ratio));
    let sum = 0;
    for (let j = start; j < end; j++) sum += samples[j];
    out[i] = sum / Math.max(1, end - start);
  }
  return out;
}

function encodeWav(samples: Float32Array): Blob {
  const view = new DataView(new ArrayBuffer(44 + samples.length * 2));
  const writeText = (offset: number, text: string) => {
    for (let i = 0; i < text.length; i++) view.setUint8(offset + i, text.charCodeAt(i));
  };
  writeText(0, "RIFF");
  view.setUint32(4, 36 + samples.length * 2, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, OUTPUT_RATE, true);
  view.setUint32(28, OUTPUT_RATE * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, samples.length * 2, true);
  samples.forEach((sample, i) => {
    const clipped = Math.max(-1, Math.min(1, sample));
    view.setInt16(44 + i * 2, clipped < 0 ? clipped * 0x8000 : clipped * 0x7fff, true);
  });
  return new Blob([view], { type: "audio/wav" });
}
