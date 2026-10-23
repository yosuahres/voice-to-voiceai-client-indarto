"""Command-line runner for day-one testing.

  python cli.py samples/ru.wav --direction ru-id --out out/result.wav
  python cli.py --selftest           # synthesise test sentences and run both directions
"""

import argparse
import json
import sys
import time
from pathlib import Path

from app.pipeline import Pipeline

SELFTEST_SENTENCES = {
    "ru-id": "Здравствуйте, где находится ближайшая больница?",
    "id-ru": "Selamat pagi, saya ingin memesan dua tiket ke Jakarta.",
}


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("audio", nargs="?", help="input audio file (wav/webm/m4a/mp3)")
    ap.add_argument("--direction", choices=["ru-id", "id-ru"], default="ru-id")
    ap.add_argument("--out", default="out/result.wav")
    ap.add_argument("--selftest", action="store_true")
    args = ap.parse_args()

    t = time.perf_counter()
    pipe = Pipeline()
    print(f"[load] {time.perf_counter() - t:.1f}s  {pipe.load_timings}", file=sys.stderr)

    out_dir = Path(args.out).parent
    out_dir.mkdir(parents=True, exist_ok=True)

    if args.selftest:
        for direction, sentence in SELFTEST_SENTENCES.items():
            src = direction.split("-")[0]
            wav = pipe.speak(sentence, src)
            (out_dir / f"selftest-input-{direction}.wav").write_bytes(wav)
            res = pipe.run(wav, direction)
            (out_dir / f"selftest-output-{direction}.wav").write_bytes(res.audio_wav)
            print(json.dumps({"input_text": sentence, **res.summary()}, ensure_ascii=False, indent=2))
        return 0

    if not args.audio:
        ap.error("audio file required unless --selftest")
    data = Path(args.audio).read_bytes()
    res = pipe.run(data, args.direction)
    Path(args.out).write_bytes(res.audio_wav)
    print(json.dumps(res.summary(), ensure_ascii=False, indent=2))
    print(f"[saved] {args.out}", file=sys.stderr)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
