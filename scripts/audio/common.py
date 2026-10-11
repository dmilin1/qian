"""Shared helpers for the audio toolchain: paths, secrets, ElevenLabs client, audio I/O, pinyin utils.

Nothing in here prints or logs the API key.
"""

from __future__ import annotations

import hashlib
import io
import json
import os
import random
import re
import threading
import time
import unicodedata
import zlib
from dataclasses import dataclass
from pathlib import Path
from typing import Any

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
AUDIO_DIR = Path(__file__).resolve().parent

VOICE_ID = "9lHjugDhwqoxA5MhX0az"  # "Anna Su", Taiwan Mandarin (cmn-TW)
API_BASE = "https://api.elevenlabs.io"

# We always request raw 16-bit PCM and encode the mp3 ourselves (PyAV/libmp3lame): this lets us
# trim silence and QC the audio without a lossy decode/re-encode cycle. Credit cost is identical.
PCM_FORMAT = "pcm_24000"
PCM_RATE = 24000

# Final file format: mono 24 kHz MP3, CBR 48 kbps (see NOTES.md for the size/quality comparison).
MP3_BITRATE = 48_000

# Model -> credits per character (from GET /v1/models model_rates.character_cost_multiplier).
MODEL_COST = {
    "eleven_multilingual_v2": 1.0,
    "eleven_v3": 1.0,
    "eleven_v4": 1.0,
    "eleven_flash_v2_5": 0.5,
    "eleven_turbo_v2_5": 0.5,
    "eleven_v4_turbo": 0.5,
}
# Models that reject previous_text/next_text.
NO_CONTEXT_MODELS = {"eleven_v3"}


# --------------------------------------------------------------------------------------------
# Secrets
# --------------------------------------------------------------------------------------------

def load_api_key() -> str:
    """Read ELEVENLABS_API_KEY from .env.local (preferred) or the environment. Never printed."""
    env_file = ROOT / ".env.local"
    if env_file.exists():
        for line in env_file.read_text(encoding="utf-8").splitlines():
            line = line.strip()
            if line.startswith("ELEVENLABS_API_KEY"):
                _, _, val = line.partition("=")
                val = val.strip().strip('"').strip("'")
                if val:
                    return val
    val = os.environ.get("ELEVENLABS_API_KEY", "").strip()
    if not val:
        raise SystemExit("ELEVENLABS_API_KEY not found in .env.local or environment")
    return val


# --------------------------------------------------------------------------------------------
# ElevenLabs client
# --------------------------------------------------------------------------------------------

class ApiError(Exception):
    def __init__(self, status: int, body: str):
        super().__init__(f"HTTP {status}: {body[:300]}")
        self.status = status
        self.body = body


class QuotaExceeded(ApiError):
    pass


@dataclass
class TTSResult:
    pcm: bytes
    cost: float | None  # from the 'character-cost' response header, if present
    request_id: str | None
    max_concurrency: int | None


class ElevenClient:
    """Thin requests-based client with retry/backoff on 429/5xx and network errors."""

    def __init__(self, api_key: str | None = None, timeout: float = 60.0, max_retries: int = 6):
        import requests  # local import keeps `--help` fast

        self._requests = requests
        self._key = api_key or load_api_key()
        self.timeout = timeout
        self.max_retries = max_retries
        self.session = requests.Session()
        self.session.headers.update({"xi-api-key": self._key})
        self.max_concurrency: int | None = None
        self._lock = threading.Lock()

    def subscription(self) -> dict[str, Any]:
        r = self._request("GET", "/v1/user/subscription")
        return r.json()

    def remaining_credits(self) -> tuple[int, int, int]:
        """(used, limit, remaining) for the current billing period."""
        d = self.subscription()
        used = int(d.get("character_count", 0))
        limit = int(d.get("character_limit", 0))
        return used, limit, limit - used

    def tts(
        self,
        text: str,
        model: str,
        voice_settings: dict[str, Any],
        seed: int | None = None,
        language_code: str | None = "zh",
        previous_text: str | None = None,
        next_text: str | None = None,
        voice_id: str = VOICE_ID,
        output_format: str = PCM_FORMAT,
    ) -> TTSResult:
        body: dict[str, Any] = {"text": text, "model_id": model, "voice_settings": voice_settings}
        if seed is not None:
            body["seed"] = int(seed) % 4294967296
        if language_code:
            body["language_code"] = language_code
        if model not in NO_CONTEXT_MODELS:
            if previous_text:
                body["previous_text"] = previous_text
            if next_text:
                body["next_text"] = next_text
        path = f"/v1/text-to-speech/{voice_id}?output_format={output_format}"
        try:
            r = self._request("POST", path, json=body)
        except ApiError as e:
            # Some models reject language_code; retry once without it.
            if e.status in (400, 422) and "language" in e.body.lower() and language_code:
                return self.tts(text, model, voice_settings, seed, None, previous_text, next_text,
                                voice_id, output_format)
            raise
        cost = r.headers.get("character-cost")
        mc = r.headers.get("maximum-concurrent-requests")
        if mc and mc.isdigit():
            with self._lock:
                self.max_concurrency = int(mc)
        return TTSResult(
            pcm=r.content,
            cost=float(cost) if cost not in (None, "") else None,
            request_id=r.headers.get("request-id"),
            max_concurrency=int(mc) if mc and mc.isdigit() else None,
        )

    def _request(self, method: str, path: str, **kw):
        url = API_BASE + path
        delay = 1.0
        last_exc: Exception | None = None
        for attempt in range(self.max_retries + 1):
            try:
                r = self.session.request(method, url, timeout=self.timeout, **kw)
            except self._requests.RequestException as e:  # network hiccup
                last_exc = e
                if attempt == self.max_retries:
                    break
                time.sleep(delay + random.random())
                delay = min(delay * 2, 30)
                continue
            if r.status_code == 200:
                return r
            body = r.text
            low = body.lower()
            if r.status_code == 401 and ("quota" in low or "credits" in low):
                raise QuotaExceeded(r.status_code, body)
            if r.status_code == 429 or r.status_code >= 500:
                last_exc = ApiError(r.status_code, body)
                if attempt == self.max_retries:
                    break
                retry_after = r.headers.get("retry-after")
                wait = float(retry_after) if retry_after and retry_after.replace(".", "").isdigit() else delay
                time.sleep(wait + random.random())
                delay = min(delay * 2, 30)
                continue
            raise ApiError(r.status_code, body)
        assert last_exc is not None
        raise last_exc


# --------------------------------------------------------------------------------------------
# Audio
# --------------------------------------------------------------------------------------------

def pcm_to_float(pcm: bytes) -> np.ndarray:
    if len(pcm) % 2:
        pcm = pcm[:-1]
    return np.frombuffer(pcm, dtype="<i2").astype(np.float32) / 32768.0


def float_to_pcm(x: np.ndarray) -> bytes:
    return (np.clip(x, -1.0, 1.0) * 32767.0).astype("<i2").tobytes()


def trim_silence(
    x: np.ndarray,
    sr: int = PCM_RATE,
    keep_ms: float = 80.0,
    min_excess_ms: float = 120.0,
    rel_db: float = -45.0,
    abs_floor: float = 10 ** (-60 / 20),
    fade_ms: float = 8.0,
) -> tuple[np.ndarray, dict[str, float]]:
    """Trim leading/trailing silence, keeping `keep_ms` of padding.

    A 10 ms frame counts as sound if its RMS is above max(abs_floor, peak_rms * rel_db). We only
    trim a side if the silence there exceeds keep_ms + min_excess_ms, so normal clips are untouched.
    A short linear fade is applied to any edge that was cut to avoid clicks.
    """
    info = {"lead_ms": 0.0, "tail_ms": 0.0, "trimmed_lead_ms": 0.0, "trimmed_tail_ms": 0.0}
    if x.size == 0:
        return x, info
    hop = int(sr * 0.01)
    n = len(x) // hop
    if n < 3:
        return x, info
    frames = x[: n * hop].reshape(n, hop)
    rms = np.sqrt(np.mean(frames.astype(np.float64) ** 2, axis=1) + 1e-12)
    thr = max(abs_floor, rms.max() * 10 ** (rel_db / 20))
    loud = np.nonzero(rms > thr)[0]
    if loud.size == 0:
        return x, info
    first, last = int(loud[0]), int(loud[-1])
    lead = first * hop
    tail = len(x) - (last + 1) * hop
    info["lead_ms"] = lead / sr * 1000
    info["tail_ms"] = tail / sr * 1000
    keep = int(sr * keep_ms / 1000)
    excess = int(sr * min_excess_ms / 1000)
    start, end = 0, len(x)
    if lead > keep + excess:
        start = lead - keep
    if tail > keep + excess:
        end = len(x) - (tail - keep)
    y = x[start:end].copy()
    f = int(sr * fade_ms / 1000)
    if start > 0 and len(y) > 2 * f:
        y[:f] *= np.linspace(0, 1, f, dtype=np.float32)
    if end < len(x) and len(y) > 2 * f:
        y[-f:] *= np.linspace(1, 0, f, dtype=np.float32)
    info["trimmed_lead_ms"] = start / sr * 1000
    info["trimmed_tail_ms"] = (len(x) - end) / sr * 1000
    return y, info


def _encode(x: np.ndarray, sr: int, codec: str, container: str, bit_rate: int | None) -> bytes:
    import av

    buf = io.BytesIO()
    with av.open(buf, mode="w", format=container) as out:
        stream = out.add_stream(codec, rate=sr)
        if bit_rate:
            stream.bit_rate = bit_rate
        stream.layout = "mono"
        pcm = (np.clip(x, -1, 1) * 32767).astype(np.int16)
        # Feed in 1152-sample chunks (mp3 frame size); encoder buffers as needed.
        step = 4608
        for i in range(0, len(pcm), step):
            chunk = pcm[i : i + step].reshape(1, -1)
            frame = av.AudioFrame.from_ndarray(chunk, format="s16", layout="mono")
            frame.sample_rate = sr
            for packet in stream.encode(frame):
                out.mux(packet)
        for packet in stream.encode(None):
            out.mux(packet)
    return buf.getvalue()


def encode_mp3(x: np.ndarray, sr: int = PCM_RATE, bit_rate: int = MP3_BITRATE) -> bytes:
    return _encode(x, sr, "libmp3lame", "mp3", bit_rate)


def encode_flac(x: np.ndarray, sr: int = PCM_RATE) -> bytes:
    return _encode(x, sr, "flac", "flac", None)


def decode_audio(path_or_bytes: str | Path | bytes, sr: int = 16000) -> np.ndarray:
    """Decode any audio file (mp3/flac/wav) to mono float32 at `sr` (uses faster-whisper's PyAV decoder)."""
    from faster_whisper.audio import decode_audio as _dec

    src = io.BytesIO(path_or_bytes) if isinstance(path_or_bytes, (bytes, bytearray)) else str(path_or_bytes)
    return _dec(src, sampling_rate=sr)


def resample(x: np.ndarray, sr_in: int, sr_out: int) -> np.ndarray:
    if sr_in == sr_out:
        return x
    n_out = int(round(len(x) * sr_out / sr_in))
    t_in = np.arange(len(x)) / sr_in
    t_out = np.arange(n_out) / sr_out
    return np.interp(t_out, t_in, x).astype(np.float32)


# --------------------------------------------------------------------------------------------
# Text / pinyin
# --------------------------------------------------------------------------------------------

_PUNCT_RE = re.compile(r"[\s　-〿＀-／：-＠［-｀｛-･"
                       r"!-/:-@\[-`{-~‐-⁯·]+")

_cc_t2s = None
_cc_lock = threading.Lock()


def to_simplified(s: str) -> str:
    global _cc_t2s
    with _cc_lock:
        if _cc_t2s is None:
            import opencc

            _cc_t2s = opencc.OpenCC("t2s")
        return _cc_t2s.convert(s)


def normalize_zh(s: str) -> str:
    """Script- and punctuation-insensitive form for comparing Chinese text."""
    s = unicodedata.normalize("NFKC", s)
    s = to_simplified(s)
    s = _PUNCT_RE.sub("", s)
    return s.lower()


_TONE_MARKS = {
    "ā": ("a", 1), "á": ("a", 2), "ǎ": ("a", 3), "à": ("a", 4),
    "ē": ("e", 1), "é": ("e", 2), "ě": ("e", 3), "è": ("e", 4),
    "ī": ("i", 1), "í": ("i", 2), "ǐ": ("i", 3), "ì": ("i", 4),
    "ō": ("o", 1), "ó": ("o", 2), "ǒ": ("o", 3), "ò": ("o", 4),
    "ū": ("u", 1), "ú": ("u", 2), "ǔ": ("u", 3), "ù": ("u", 4),
    "ǖ": ("v", 1), "ǘ": ("v", 2), "ǚ": ("v", 3), "ǜ": ("v", 4), "ü": ("v", 0),
    "ń": ("n", 2), "ň": ("n", 3), "ǹ": ("n", 4), "ḿ": ("m", 2),
}


def parse_numbered(pn: str) -> list[tuple[str, int]]:
    """'zhi1 dao4' -> [('zhi',1),('dao',4)]; neutral = 5; 'ü'/'u:' -> 'v'."""
    out = []
    for tok in pn.lower().replace("u:", "v").replace("ü", "v").split():
        m = re.fullmatch(r"([a-zv]+)([0-5]?)", tok)
        if not m:
            continue
        tone = int(m.group(2)) if m.group(2) else 5
        out.append((m.group(1), 5 if tone == 0 else tone))
    return out


def parse_marked_syllable(syl: str) -> tuple[str, int]:
    """'hǎo' -> ('hao', 3); 'de' -> ('de', 5)."""
    tone = 5
    base = []
    for ch in unicodedata.normalize("NFC", syl.lower()):
        if ch in _TONE_MARKS:
            b, t = _TONE_MARKS[ch]
            base.append(b)
            if t:
                tone = t
        elif ch.isalpha():
            base.append(ch)
    return "".join(base), tone


def hanzi_count(s: str) -> int:
    return sum(1 for c in s if "㐀" <= c <= "鿿" or "豈" <= c <= "﫿")


# --------------------------------------------------------------------------------------------
# Misc
# --------------------------------------------------------------------------------------------

def stable_seed(key: str, attempt: int = 0) -> int:
    return (zlib.crc32(key.encode("utf-8")) + attempt * 104729) % 4294967296


def sha1(obj: Any) -> str:
    s = obj if isinstance(obj, str) else json.dumps(obj, sort_keys=True, ensure_ascii=False)
    return hashlib.sha1(s.encode("utf-8")).hexdigest()[:16]


def estimate_cost(text: str, model: str) -> float:
    """Conservative estimate: every character (incl. punctuation) billed at the model multiplier."""
    return len(text) * MODEL_COST.get(model, 1.0)


def load_json(path: Path, default: Any) -> Any:
    if path.exists():
        return json.loads(path.read_text(encoding="utf-8"))
    return default


def write_json_atomic(path: Path, data: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    tmp.write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    os.replace(tmp, path)


def context_from_example(word: str, sentence: str) -> tuple[str | None, str | None]:
    """Split the example sentence around the word so it can be sent as previous_text/next_text."""
    i = sentence.find(word)
    if i < 0:
        return None, None
    prev = sentence[:i] or None
    nxt = sentence[i + len(word):] or None
    return prev, nxt


def voice_settings(kind: str, model: str, speed: float | None = None) -> dict[str, Any]:
    """Default voice settings: favor consistency (high stability, no style exaggeration).

    kind: 'word' or 'sentence'. Words are slowed a little for clarity.
    """
    if speed is None:
        speed = 0.9 if kind == "word" else 0.95
    if model == "eleven_v3":
        # v3 only accepts stability 0.0 / 0.5 / 1.0 (Creative / Natural / Robust).
        return {"stability": 1.0, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True,
                "speed": speed}
    return {"stability": 0.75, "similarity_boost": 0.75, "style": 0.0, "use_speaker_boost": True,
            "speed": speed}
