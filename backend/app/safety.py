"""Kid-safety guardrails ("brand safety").

Two layers:
  1. Term lists (safety_terms.json): profanity, insults/bullying, sexual content, hate, self-harm and threats.
     Every learner input (search, topic, pasted text, deep-dive question, text read from a photo) is checked
     before anything else happens, and every generated storyboard is checked before it is saved.
  2. With an API key, Claude gets age-appropriate content rules in its prompts and flags requests that aren't
     suitable for a school library (generator.py / vision.py), which catches what a word list can't.

Sensitive but legitimate school topics (wars, the Holocaust, reproduction, drugs and the brain, slavery) are
allowed: the lists target language and intent, not subjects.
"""
from __future__ import annotations

import json
import os
import re
from functools import lru_cache
from pathlib import Path

TERMS_FILE = Path(os.environ.get("SAFETY_TERMS_FILE", Path(__file__).parent / "safety_terms.json"))
MESSAGE = "Let's keep ConceptReel classroom-friendly. Try rephrasing it the way you'd ask a teacher."
# Student-facing messages from the prompt pack. Never show raw model output or which filter fired.
MESSAGES = {
    "language": MESSAGE,
    "not_study_material": "Hmm, this doesn't look like a page from a textbook or worksheet. Try taking a photo of the page you're studying!",
    "blocked": "This page isn't something we can make a lesson from. Ask your teacher if you need help with it.",
    "illegible": "We couldn't read that photo. Try a sharper, well-lit photo of the whole page.",
    "pii": "We kept some personal details in your photo private: the photo won't be shown to other learners.",
    "assessment": "This looks like a quiz or test, so we'll help you learn the ideas behind it instead of giving answers.",
    "deep_dive_limit": "You've gone as deep as this lesson goes! Want to try a related topic?",
    "off_topic": "Let's stay on today's lesson. Try asking about the part of the video you're watching.",
    "declined": "We can't make a lesson on that for your grade. Ask your teacher if you need help with it.",
    "hold": "Something went wrong checking that lesson, so we didn't show it. No tokens were used. Please try again.",
    "held_for_teacher": "Your lesson is ready and waiting for a teacher to approve it. No tokens were used yet.",
    "distress": "It sounds like something might be hard right now. Please talk to a trusted adult, like a parent, teacher, "
                "or school counselor. If you are in the U.S. and need to talk to someone now, you can call or text 988.",
}
LABELS = {"profanity": "profanity", "insults_bullying": "insults or bullying", "sexual": "sexual content",
          "hate": "hate speech", "self_harm": "self-harm", "threats_violence": "threats or violence",
          "unsuitable_request": "a request that isn't suitable for a school library"}
LEET = str.maketrans({"@": "a", "4": "a", "3": "e", "1": "i", "!": "i", "0": "o", "$": "s", "5": "s", "7": "t", "+": "t"})


class Unsafe(Exception):
    def __init__(self, categories: list[str], where: str):
        self.categories, self.where = categories, where
        super().__init__(MESSAGES["distress"] if "self_harm" in categories else MESSAGE)


def _normalize(text: str) -> str:
    t = text.lower().replace("’", "'")
    # Masked letters inside a word (f*ck, sh!t, b@stard) → undo leetspeak, treat * as a wildcard letter.
    t = re.sub(r"\b[\w@$!*+]*[@$!*+0-9][\w@$!*+]*\b|[\w@$!*+]+", lambda m: m.group().translate(LEET), t)
    t = re.sub(r"(.)\1{2,}", r"\1", t)  # fuuuuck → fuck
    # Spaced-out letters: "f u c k" / "f.u.c.k" → "fuck"
    t = re.sub(r"\b(?:[a-z][\s._-]){2,}[a-z]\b", lambda m: re.sub(r"[\s._-]", "", m.group()), t)
    return re.sub(r"\s+", " ", t)


def _pattern(term: str) -> str:
    term = term.lower().strip()
    stem = term.endswith("*")
    words = [re.escape(w).replace(r"\*", "[a-z*]") for w in term.rstrip("*").split()]
    # Allow masking characters to stand in for single letters inside the term (f*ck, sh*t).
    body = r"\s+".join("".join(f"(?:{c}|\\*)" if c.isalpha() else c for c in w) if len(w) > 2 else w for w in words)
    return r"(?<![a-z])" + body + (r"[a-z]*" if stem else r"(?![a-z])")


@lru_cache(maxsize=1)
def _rules():
    data = json.loads(TERMS_FILE.read_text())
    block = {cat: re.compile("|".join(_pattern(t) for t in terms)) for cat, terms in data["block"].items() if terms}
    allow = re.compile("|".join(r"(?<![a-z])" + re.escape(a.lower()) + r"(?![a-z])" for a in data.get("allow", []))) \
        if data.get("allow") else None
    return block, allow


def categories(text: str | None) -> list[str]:
    if not text:
        return []
    block, allow = _rules()
    t = _normalize(text)
    if allow:
        t = allow.sub(" ", t)
    return [cat for cat, rx in block.items() if rx.search(t)]


def check(text: str | None, where: str) -> None:
    cats = categories(text)
    if cats:
        raise Unsafe(cats, where)


def storyboard_text(sb: dict) -> str:
    parts = [sb.get("title", ""), sb.get("summary", ""), " ".join(sb.get("tags") or [])]
    for s in sb.get("scenes", []):
        parts += [s.get("heading", ""), s.get("narration", "")]
        v = s.get("visual") or {}
        parts += [v.get("caption") or "", v.get("text") or "", v.get("note") or "", " ".join(v.get("steps") or []),
                  " ".join(v.get("words") or []), " ".join(i.get("t", "") for i in v.get("items") or []),
                  " ".join(e.get("t", "") for e in v.get("events") or [])]
        for side in ("left", "right"):
            col = v.get(side) or {}
            parts += [col.get("h", ""), " ".join(col.get("items") or [])]
    for q in sb.get("quiz", []):
        parts += [q.get("q", ""), " ".join(q.get("options") or [])]
    return "\n".join(p for p in parts if p)


CLAUDE_RULES = (
    "Content rules (this is a school library for 13-18 year olds): keep every word age-appropriate and kind; no "
    "profanity, slurs, insults, sexual content, graphic violence or gore, or instructions that could cause harm "
    "(weapons, drugs, self-harm, dangerous stunts). Sensitive school topics such as wars, genocide, slavery, human "
    "reproduction, drugs and the body, or mental health are fine when taught factually, respectfully and without "
    "graphic detail.")
