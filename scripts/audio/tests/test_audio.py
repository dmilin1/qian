"""Tests for the audio toolchain.  Run:  ./.venv/Scripts/python -m pytest scripts/audio/tests -q

Fast tests (no network, no whisper): pitch classifier on synthetic contours and on real bake-off
clips (fixtures/), sandhi rules, transcript comparison, trimming, budget logic.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

import numpy as np
import pytest

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))

import common as C  # noqa: E402
import qc  # noqa: E402

SR = 24000


# ------------------------------------------------------------------------------------------------
# Synthetic voiced signals with known pitch shapes
# ------------------------------------------------------------------------------------------------

def st_to_hz(st: float) -> float:
    return 100.0 * 2 ** (st / 12.0)


def synth_syllable(points: list[float], dur: float = 0.32, sr: int = SR) -> np.ndarray:
    """Harmonic-rich voiced sound whose F0 follows `points` (semitones re 100 Hz, evenly spaced)."""
    n = int(dur * sr)
    t = np.linspace(0, 1, n)
    st = np.interp(t, np.linspace(0, 1, len(points)), points)
    f0 = st_to_hz(1) * 0 + 100.0 * 2 ** (st / 12.0)
    phase = 2 * np.pi * np.cumsum(f0) / sr
    sig = sum((1.0 / k) * np.sin(k * phase) for k in range(1, 25))
    env = np.ones(n)
    a = int(0.025 * sr)
    env[:a] = np.linspace(0, 1, a)
    env[-a:] = np.linspace(1, 0, a)
    return (0.25 * sig / np.max(np.abs(sig)) * env).astype(np.float32)


def silence(sec: float) -> np.ndarray:
    return np.zeros(int(sec * SR), dtype=np.float32)


def word(*sylls: np.ndarray, gap: float = 0.07) -> np.ndarray:
    parts = [silence(0.1)]
    for i, s in enumerate(sylls):
        if i:
            parts.append(silence(gap))
        parts.append(s)
    parts.append(silence(0.1))
    return np.concatenate(parts)


# Citation-tone shapes for this voice's register (MID ~13.5 st): T1 high level, T2 rise,
# T3 low dip / low fall (Taiwan-style, no final rise), T4 high fall.
SHAPES = {
    1: [17, 17.2, 17.1, 17],
    2: [11.5, 11, 13, 16, 17.5],
    3: [11, 8.5, 7, 7.5, 8.5],
    "3fall": [11, 9, 7.5, 6.5],
    4: [18, 17, 14, 10, 8],
}

PA = qc.PitchAnalyzer()


@pytest.mark.parametrize("tone", [1, 2, 3, "3fall", 4])
def test_synthetic_correct_tone_accepted(tone):
    t = 3 if tone == "3fall" else tone
    rep = PA.check(word(synth_syllable(SHAPES[tone])), SR, "字", [t])
    assert rep["status"] == "ok", rep


@pytest.mark.parametrize("shape,expected", [
    (1, 4), (4, 1), (4, 2), (2, 4), (1, 3), (3, 1), (2, 1),
])
def test_synthetic_wrong_tone_rejected(shape, expected):
    rep = PA.check(word(synth_syllable(SHAPES[shape])), SR, "字", [expected])
    assert rep["status"] in ("weak", "mismatch"), rep


def test_synthetic_classifier_guesses():
    for tone, want in [(1, 1), (2, 2), (4, 4)]:
        sylls, _ = PA.syllables(word(synth_syllable(SHAPES[tone])), SR, 1)
        scores = qc.tone_scores(sylls[0].features())
        guess = max((1, 2, 3, 4), key=lambda k: scores[k])
        assert guess == want, (tone, scores)
    sylls, _ = PA.syllables(word(synth_syllable(SHAPES[3])), SR, 1)
    assert qc.tone_scores(sylls[0].features())[3] > 0.8


def test_synthetic_two_syllables_with_gap():
    w = word(synth_syllable(SHAPES[1]), synth_syllable(SHAPES[4]))  # e.g. 知道 zhī dào
    assert PA.check(w, SR, "知道", [1, 4])["status"] == "ok"
    assert PA.check(w, SR, "知道", [4, 1])["status"] != "ok"


def test_synthetic_two_syllables_continuous_voicing_split_by_intensity():
    # 朋友-like: no unvoiced gap, an intensity dip marks the syllable boundary.
    a = synth_syllable(SHAPES[2], 0.28)
    b = synth_syllable(SHAPES["3fall"], 0.28)
    w = word(a, b, gap=0.0)
    rep = PA.check(w, SR, "朋友", [2, 3])
    assert rep["status"] == "ok", rep


def test_third_tone_sandhi_accepted():
    # 你好 spoken ní hǎo: rising first syllable must be accepted for expected [3, 3].
    w = word(synth_syllable(SHAPES[2]), synth_syllable(SHAPES[3]))
    assert PA.check(w, SR, "你好", [3, 3])["status"] == "ok"


def test_bu_and_yi_sandhi_and_neutral():
    assert qc.allowed_tones("不要", [4, 4])[0] == {2, 4}
    assert qc.allowed_tones("不好", [4, 3])[0] == {4}
    assert {2, 4} <= qc.allowed_tones("一個", [1, 4])[0]
    assert qc.allowed_tones("東西", [1, 5])[1] == {1, 2, 3, 4, 5}
    assert 2 in qc.allowed_tones("你好", [3, 3])[0]
    assert qc.allowed_tones("想", [3], spoken_tones=[2])[0] == {2, 3}
    # A rising first syllable is accepted for 不要 (bú yào).
    w = word(synth_syllable(SHAPES[2]), synth_syllable(SHAPES[4]))
    assert PA.check(w, SR, "不要", [4, 4])["status"] == "ok"


def test_neutral_tone_never_fails():
    for shape in (1, 2, 3, 4):
        rep = PA.check(word(synth_syllable(SHAPES[shape], 0.2)), SR, "的", [5])
        assert rep["status"] == "ok"


def test_unvoiced_input_is_unknown_not_fail():
    noise = (np.random.default_rng(0).standard_normal(SR // 2) * 0.05).astype(np.float32)
    rep = PA.check(noise, SR, "是", [4])
    assert rep["status"] == "unknown"


# ------------------------------------------------------------------------------------------------
# Real clips from the model bake-off (fixtures/fixtures.json)
# ------------------------------------------------------------------------------------------------

FIX = json.loads((HERE / "fixtures" / "fixtures.json").read_text(encoding="utf-8"))


@pytest.mark.parametrize("fx", FIX, ids=[f"{f['label']}-{f['model']}-{f['text']}" for f in FIX])
def test_real_clips(fx):
    x = C.decode_audio(HERE / "fixtures" / fx["file"], sr=SR)
    tones = [t for _, t in C.parse_numbered(fx["pinyin"])]
    rep = PA.check(x, SR, fx["text"], tones)
    if fx["label"] == "ok":
        assert rep["status"] == "ok", rep["reasons"]
    else:
        assert rep["status"] in ("weak", "mismatch"), rep


# ------------------------------------------------------------------------------------------------
# Transcript comparison
# ------------------------------------------------------------------------------------------------

@pytest.mark.parametrize("heard,text,pn,status", [
    ("是", "是", "shi4", "match"),
    ("是。", "是", "shi4", "match"),
    ("事", "是", "shi4", "match"),            # homophone, same tone
    ("像", "想", "xiang3", "tone_mismatch"),  # same syllable, wrong tone
    ("上", "想", "xiang3", "mismatch"),
    ("他", "你", "ni3", "mismatch"),
    ("1", "一", "yi1", "match"),              # whisper writes digits
    ("E", "一", "yi1", "unclear"),            # Latin output carries no evidence
    ("", "一", "yi1", "empty"),
    ("认识", "認識", "ren4 shi4", "match"),   # script-insensitive
    ("樂色", "垃圾", "le4 se4", "match"),     # Taiwan reading via homophones
    ("拉雞", "垃圾", "le4 se4", "mismatch"),  # mainland reading lā jī
    ("認識你", "認識", "ren4 shi4", "partial"),
    ("勒", "了", "le5", "match"),             # neutral tone is a tone wildcard
])
def test_compare_word(heard, text, pn, status):
    assert qc.compare_word(heard, text, pn)["status"] == status


def test_compare_sentence():
    ok = qc.compare_sentence("你知道他住哪里吗?", "你知道他住哪裡嗎？")
    assert ok["status"] == "match"
    near = qc.compare_sentence("我們明天早上一起去買東西好不好", "我們明天早上一起去買東西，好不好？")
    assert near["status"] == "match"
    homophone = qc.compare_sentence("他是我的朋有", "他是我的朋友。")
    assert homophone["status"] in ("match", "near")
    bad = qc.compare_sentence("今天天氣很好", "他是我的朋友。")
    assert bad["status"] == "mismatch"


# ------------------------------------------------------------------------------------------------
# Common helpers
# ------------------------------------------------------------------------------------------------

def test_parse_pinyin():
    assert C.parse_numbered("zhi1 dao4") == [("zhi", 1), ("dao", 4)]
    assert C.parse_numbered("lü4 de5") == [("lv", 4), ("de", 5)]
    assert C.parse_marked_syllable("hǎo") == ("hao", 3)
    assert C.parse_marked_syllable("de") == ("de", 5)
    assert C.parse_marked_syllable("lǜ") == ("lv", 4)


def test_trim_keeps_padding_and_leaves_normal_clips_alone():
    tone = synth_syllable(SHAPES[1], 0.4)
    x = np.concatenate([silence(0.6), tone, silence(0.8)])
    y, info = C.trim_silence(x, SR)
    assert info["trimmed_lead_ms"] > 400 and info["trimmed_tail_ms"] > 600
    lead = len(y) - len(tone)
    assert 0.1 * SR < lead < 0.25 * SR  # ~80 ms each side kept (+ 10 ms frame granularity)
    z = np.concatenate([silence(0.08), tone, silence(0.1)])
    z2, info2 = C.trim_silence(z, SR)
    assert len(z2) == len(z) and info2["trimmed_lead_ms"] == 0


def test_mp3_roundtrip():
    x = word(synth_syllable(SHAPES[2]))
    mp3 = C.encode_mp3(x)
    assert mp3[:3] == b"ID3" or mp3[0] == 0xFF
    y = C.decode_audio(mp3, sr=SR)
    assert abs(len(y) - len(x)) < 0.1 * SR


def test_context_split():
    assert C.context_from_example("認識", "很高興認識你。") == ("很高興", "你。")
    assert C.context_from_example("垃圾", "垃圾要拿出去丟。") == (None, "要拿出去丟。")
    assert C.context_from_example("貓", "我很好。") == (None, None)


def test_budget_without_client():
    import generate as G

    b = G.Budget(None, max_credits=10, reserve=0, max_retry_credits=3)
    b.reserve_for(4, False)
    b.commit(4, 1.0, False)  # header said 1 credit
    assert b.spent == 1.0
    b.reserve_for(3, True)
    b.commit(3, None, True)  # no header: estimate is charged
    assert b.retry_spent == 3.0
    with pytest.raises(G.BudgetExceeded):
        b.reserve_for(1, True)  # retry cap
    with pytest.raises(G.BudgetExceeded):
        b.reserve_for(7, False)  # 4 spent + 7 > 10
    with pytest.raises(G.BudgetExceeded):
        b.reserve_for(1, False)  # stays stopped


def test_clip_hash_changes_with_text_and_settings():
    import argparse

    import generate as G

    args = argparse.Namespace(model="eleven_v4", fallback_model="eleven_flash_v2_5", only="", limit=0,
                              words_only=False, examples_only=False, word_speed=0.9, sentence_speed=0.95,
                              overrides=str(HERE / "nonexistent.json"))
    w = {"id": "w4f60", "rank": 1, "trad": "你", "pinyinNumbered": "ni3", "example": {"trad": "你好。"}}
    c1 = G.build_clips([w], args)
    assert [c.key for c in c1] == ["w/w4f60", "s/w4f60"]
    w2 = dict(w, example={"trad": "你們好。"})
    c2 = G.build_clips([w2], args)
    assert c1[0].hash() == c2[0].hash() and c1[1].hash() != c2[1].hash()
    args.word_speed = 1.0
    assert G.build_clips([w], args)[0].hash() != c1[0].hash()


def test_split_pinyin_taiwan_readings():
    assert qc.split_pinyin("Nǐ zhīdào tā zhù nǎlǐ ma?", 8) == ["ni", "zhi", "dao", "ta", "zhu", "na", "li", "ma"]
    assert qc.split_pinyin("Xī'ān hěn yuǎn.", 4) == ["xi", "an", "hen", "yuan"]
    assert qc.split_pinyin("Lǜsè de.", 3) == ["lv", "se", "de"]
    assert qc.split_pinyin("Nǐ hǎo", 3) is None  # count mismatch -> caller falls back to pypinyin


def test_sentence_uses_taiwan_pinyin_when_given():
    # Mainland reading lājī heard as different characters is caught against the Taiwan pinyin...
    r = qc.compare_sentence("拉機要拿出去丟", "垃圾要拿出去丟。", "Lèsè yào ná chūqù diū.")
    assert r["status"] in ("suspect", "mismatch")
    # ...while the right characters always pass.
    assert qc.compare_sentence("垃圾要拿出去丢", "垃圾要拿出去丟。", "Lèsè yào ná chūqù diū.")["status"] == "match"


@pytest.mark.skipif(not __import__("os").environ.get("QC_SLOW"), reason="set QC_SLOW=1 to run whisper end-to-end")
def test_full_qc_with_whisper_on_real_clips():
    device = qc.resolve_device("auto")
    checker = qc.QC("large-v3" if device == "cuda" else "small", device=device)
    by_name = {f["text"] + f["model"]: f for f in FIX}
    for key in ("是eleven_v4", "朋友eleven_v4", "認識eleven_v4"):
        fx = by_name[key]
        x = C.decode_audio(HERE / "fixtures" / fx["file"], sr=SR)
        rep = checker.check_word(x, SR, fx["text"], fx["pinyin"])
        assert rep["verdict"] == "pass", rep["reasons"]
    fx = by_name["垃圾eleven_multilingual_v2"]  # mainland reading lājī
    rep = checker.check_word(C.decode_audio(HERE / "fixtures" / fx["file"], sr=SR), SR, fx["text"], fx["pinyin"])
    assert rep["verdict"] != "pass"
