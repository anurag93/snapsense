"""Grade bands (from the K-12 guardrail prompt pack). These fill the {{variables}} in prompts.py and drive
code-side limits. Districts should only ever make them stricter."""
from __future__ import annotations

BANDS = {
    "K-2": {"ages": "5-8", "reading_level": "Grade 1-2", "max_sentence_words": 10, "target_minutes": "2-3",
            "scenes": "3-4", "max_key_points": 3, "max_depth": 1, "checkpoints": 1, "options": 2,
            "allowed_formats": "picture-friendly multiple choice with 2 options, true/false", "free_text": False},
    "3-5": {"ages": "8-11", "reading_level": "Grade 3-5", "max_sentence_words": 15, "target_minutes": "3-5",
            "scenes": "4-5", "max_key_points": 4, "max_depth": 2, "checkpoints": 2, "options": 3,
            "allowed_formats": "multiple choice, true/false", "free_text": False},
    "6-8": {"ages": "11-14", "reading_level": "Grade 6-8", "max_sentence_words": 20, "target_minutes": "4-6",
            "scenes": "4-6", "max_key_points": 5, "max_depth": 2, "checkpoints": 2, "options": 3,
            "allowed_formats": "multiple choice", "free_text": True},
    "9-12": {"ages": "14-18", "reading_level": "Grade 9-12", "max_sentence_words": 25, "target_minutes": "5-8",
             "scenes": "5-6", "max_key_points": 6, "max_depth": 3, "checkpoints": 3, "options": 4,
             "allowed_formats": "multiple choice, explain-why framed as multiple choice", "free_text": True},
}
ORDER = list(BANDS)
GRADES = ["K", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]
# Demo learners: in production the school or teacher account assigns this at onboarding.
DEMO_GRADES = {"Maya": "9", "Leo": "11", "Priya": "7"}


def band_for_grade(grade: str | None) -> str:
    g = str(grade or "").strip().upper()
    if g in ("K", "0"):
        return "K-2"
    try:
        n = int(g)
    except ValueError:
        return "9-12"
    return "K-2" if n <= 2 else "3-5" if n <= 5 else "6-8" if n <= 8 else "9-12"


def band_for_video(v: dict) -> str:
    """Videos store gradeBand; older library videos only have a grade range such as '8-9'."""
    if v.get("gradeBand") in BANDS:
        return v["gradeBand"]
    low = str(v.get("grade") or "9").split("-")[0]
    return band_for_grade(low)


def distance(a: str, b: str) -> int:
    return abs(ORDER.index(a) - ORDER.index(b))
