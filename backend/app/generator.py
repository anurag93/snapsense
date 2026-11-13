"""Storyboard generator.

A "video" is a storyboard: scenes with narration, an on-screen visual and a quick quiz. The browser
renders it as an animated, narrated video, so generating one is a single cheap LLM call instead of
pixel-level video generation.

With ANTHROPIC_API_KEY set, Claude writes the storyboard (and reads any photo). Otherwise an offline
generator builds one from the text the learner pasted or that OCR read from their photo.
"""
from __future__ import annotations

import os
import re
from typing import List, Literal, Optional

from pydantic import BaseModel

from . import prompts as P
from . import safety

MODEL = os.environ.get("CLAUDE_MODEL", "claude-opus-5-5")
_client = None
if os.environ.get("ANTHROPIC_API_KEY") or os.environ.get("ANTHROPIC_AUTH_TOKEN"):
    from anthropic import AsyncAnthropic
    _client = AsyncAnthropic()


def mode() -> str:
    return "claude" if _client else "offline"


def client():
    return _client


class GenError(Exception):
    def __init__(self, message: str, status: int = 500):
        super().__init__(message)
        self.status = status


# ---------------- schema shared by both generators ----------------
class Item(BaseModel):
    e: str
    t: str


class Column(BaseModel):
    h: str
    items: List[str]


class Event(BaseModel):
    y: str
    t: str


class Visual(BaseModel):
    kind: Literal["title", "icons", "flow", "equation", "compare", "timeline", "keywords"]
    emoji: Optional[str]
    caption: Optional[str]
    items: Optional[List[Item]]
    steps: Optional[List[str]]
    text: Optional[str]
    note: Optional[str]
    left: Optional[Column]
    right: Optional[Column]
    events: Optional[List[Event]]
    words: Optional[List[str]]


class Checkpoint(BaseModel):
    q: str
    options: List[str]
    answer: int
    hint: str
    feedback_correct: str
    feedback_incorrect: str
    explanation: str


class Scene(BaseModel):
    heading: str
    narration: str
    visual: Visual
    checkpoint: Optional[Checkpoint]


class QuizQ(BaseModel):
    q: str
    options: List[str]
    answer: int
    explanation: str


class Storyboard(BaseModel):
    status: Literal["ok", "declined"]
    decline_reason: str
    title: str
    subject: str
    grade: str
    summary: str
    tags: List[str]
    learning_objectives: List[str]
    scenes: List[Scene]
    quiz: List[QuizQ]
    teacher_note: str
    needs_human_review: bool


class Explainer(BaseModel):
    status: Literal["ok", "at_limit", "redirect"]
    suggestion: str
    title: str
    misconception_addressed: str
    scenes: List[Scene]
    quiz: List[QuizQ]


class Check(BaseModel):
    result: Literal["pass", "fail", "n/a"]
    evidence: str
    fix: str


class ReviewChecks(BaseModel):
    age_appropriate: Check
    factual_vs_source: Check
    no_harmful_content: Check
    neutral_and_unbiased: Check
    no_personal_data: Check
    reading_level: Check
    tone_and_boundaries: Check
    no_commercial: Check
    accessibility: Check
    academic_integrity: Check
    questions_valid: Check


class Review(BaseModel):
    checks: ReviewChecks
    overall: Literal["pass", "fail"]
    needs_human_review: bool
    teacher_note: str


class Declined(Exception):
    """The model declined (status declined / at_limit / redirect). kind picks the student-facing message."""
    def __init__(self, kind: str, suggestion: str = ""):
        super().__init__(kind)
        self.kind, self.suggestion = kind, suggestion


async def _parse(system: str, content, schema, where: str):
    res = await _client.messages.parse(
        model=MODEL, max_tokens=16000, output_config={"effort": "low"}, output_format=schema,
        system=system, messages=[{"role": "user", "content": content}],
    )
    if res.stop_reason == "refusal":
        raise safety.Unsafe(["unsuitable_request"], where)
    if res.parsed_output is None:  # fail closed on anything that isn't valid JSON for the schema
        raise GenError("Generation failed")
    return res.parsed_output.model_dump()


def _source_block(source_text: str) -> str:
    return f"\n<source>\n{source_text}\n</source>" if source_text else "\n<source></source>"


async def _claude_storyboard(topic, source_text, image, band, assessment_mode, fix_notes):
    text = (P.storyboard_task(band, assessment_mode) + f"\n\n<topic>{topic or '(work it out from the photo)'}</topic>"
            + _source_block(source_text))
    if image:
        text += "\nThe attached photo is the page the student is studying; the <source> text was read from it."
    if fix_notes:
        text += f"\n\nA reviewer rejected the previous draft. Fix these issues:\n<review_notes>\n{fix_notes}\n</review_notes>"
    content = ([{"type": "image", "source": {"type": "base64", "media_type": image["mediaType"], "data": image["data"]}},
                {"type": "text", "text": text}] if image else text)
    out = await _parse(P.compliance(band), content, Storyboard, "generate")
    if out.pop("status") != "ok":
        raise Declined("declined")
    out.pop("decline_reason", None)
    return out


async def _claude_explainer(video, scene_idx, question, band, depth, fix_notes):
    import json
    scene = video["scenes"][scene_idx]
    parent = {"title": video["title"], "scenes": [{"id": i, "heading": s["heading"], "narration": s["narration"]}
                                                  for i, s in enumerate(video["scenes"])]}
    text = (P.explainer_task(band, depth) + f"\n\nThe part they got stuck on is scene {scene_idx}, \"{scene['heading']}\"."
            + f"\n<parent_script>{json.dumps(parent, ensure_ascii=False)}</parent_script>"
            + f"\n<question>{question}</question>" * bool(question))
    if fix_notes:
        text += f"\n\nA reviewer rejected the previous draft. Fix these issues:\n<review_notes>\n{fix_notes}\n</review_notes>"
    out = await _parse(P.compliance(band), text, Explainer, "deep dive")
    status = out.pop("status")
    if status != "ok":
        raise Declined(status, out.get("suggestion", ""))
    out.pop("suggestion", None)
    return out


async def review(band: str, source_text: str, output: dict, assessment_mode: bool) -> dict:
    """Prompt 5: an independent review call. Returns {"status": PASS|REVISE, "fix_notes", "needs_human_review",
    "teacher_note", "failed": [...]}. Offline mode has no reviewer model, so code checks stand in (see main.py)."""
    import json
    text = (f"Assessment mode: {'on' if assessment_mode else 'off'}." + _source_block(source_text)
            + f"\n<output>\n{json.dumps(output, ensure_ascii=False)}\n</output>")
    r = await _parse(P.review(band), text, Review, "review")
    failed = {k: c for k, c in r["checks"].items() if c["result"] == "fail"}
    return {"status": "PASS" if r["overall"] == "pass" and not failed else "REVISE",
            "fix_notes": "\n".join(f"- {k}: {c['evidence']} -> {c['fix']}" for k, c in failed.items()),
            "failed": sorted(failed), "needs_human_review": r["needs_human_review"], "teacher_note": r["teacher_note"]}


def validate_questions(sb: dict) -> list[str]:
    """Code-side answer-key checks (the pack: exactly one correct option, valid index)."""
    problems = []
    qs = [("quiz", q) for q in sb.get("quiz", [])] + [("checkpoint", s["checkpoint"]) for s in sb.get("scenes", [])
                                                     if s.get("checkpoint")]
    for where, q in qs:
        opts = [str(o).strip().lower() for o in q.get("options") or []]
        if len(opts) < 2 or len(set(opts)) != len(opts):
            problems.append(f"{where}: options must be 2+ and distinct")
        elif not (0 <= int(q.get("answer", -1)) < len(opts)):
            problems.append(f"{where}: answer index out of range")
    return problems

# ---------------- offline generator ----------------
EMOJI = {
    "war": "⚔️", "king": "👑", "queen": "👑", "money": "💰", "tax": "💰", "trade": "🚢", "ship": "🚢", "water": "💧",
    "sun": "☀️", "light": "💡", "energy": "⚡", "cell": "🧫", "dna": "🧬", "gene": "🧬", "heart": "❤️", "blood": "🩸",
    "brain": "🧠", "plant": "🌱", "tree": "🌳", "animal": "🐾", "earth": "🌍", "planet": "🪐", "star": "⭐", "atom": "⚛️",
    "electron": "⚛️", "acid": "🧪", "reaction": "🧪", "heat": "🔥", "fire": "🔥", "force": "💪", "speed": "🏎️", "time": "⏳",
    "number": "🔢", "equation": "🟰", "graph": "📈", "growth": "📈", "city": "🏙️", "farm": "🌾", "people": "👥", "law": "⚖️",
    "vote": "🗳️", "government": "🏛️", "empire": "🏛️", "book": "📖", "idea": "💡", "machine": "⚙️", "factory": "🏭",
    "ocean": "🌊", "mitochondria": "🔋", "glucose": "🍬", "sugar": "🍬", "oxygen": "🫧", "carbon": "⚫", "molecule": "🧪",
    "protein": "🥩", "enzyme": "✂️", "bacteria": "🦠", "volcano": "🌋", "rock": "🪨", "magnet": "🧲", "wave": "〰️",
    "sound": "🔊", "electricity": "⚡", "current": "⚡", "battery": "🔋", "revolution": "✊", "colony": "🏴", "treaty": "📜",
    "slavery": "⛓️", "religion": "⛪", "church": "⛪", "army": "🪖", "soldier": "🪖", "poem": "📝", "poetry": "📝",
    "story": "📚", "character": "🎭", "fraction": "➗", "angle": "📐", "circle": "⭕", "function": "📈", "probability": "🎲",
    "population": "👥", "river": "🏞️", "rain": "🌧️", "climate": "🌡️", "food": "🍎", "disease": "🦠", "virus": "🦠",
    "computer": "💻", "map": "🗺️",
}
STOP = set(("a an the of to in on for and or is are was were be been it its this that how what why when where who which do "
            "does did can could would should i me my you your we our they their them he she his her with as at by from into "
            "about explain explained understand learn tell show please video videos work works working happen happens "
            "happened between vs versus").split())
COMMON = set(("also very much many more most other some such than then there these those this that with from have has had "
              "were will would could should into over under after before because while which where when what about their them "
              "they being been only just like made make makes using used each between both through during against among "
              "within without").split())
NULL_VISUAL = {k: None for k in ("emoji", "caption", "items", "steps", "text", "note", "left", "right", "events", "words")}


def _cap(s):
    return s[:1].upper() + s[1:]


def _emoji(w):
    return EMOJI.get(w) or EMOJI.get(re.sub(r"s$", "", w)) or "🔹"


def _sentences(text):
    parts = re.findall(r"[^.!?]+[.!?]+|[^.!?]+$", re.sub(r"\s+", " ", str(text or "")))
    return [p.strip() for p in parts if len(p.strip().split()) > 3]


def keywords(text, n=4):
    counts = {}
    for w in re.findall(r"[a-z][a-z-]{3,}", str(text).lower()):
        if w in STOP or w in COMMON:
            continue
        counts[w] = counts.get(w, 0) + 1
    return [w for w, _ in sorted(counts.items(), key=lambda kv: (-kv[1], -len(kv[0])))[:n]]


def _visual_for(sentence, i):
    kws = keywords(sentence, 4)
    years = re.findall(r"\b(1[0-9]{3}|20[0-9]{2})\b", sentence)
    if re.search(r"[=+×÷]|\^|\bequals\b", sentence):
        m = re.search(r"[^,.;:]*=[^,.;:]*", sentence)
        return {**NULL_VISUAL, "kind": "equation", "text": (m.group(0) if m else sentence).strip()[:60], "note": " · ".join(kws[:2])}
    if years:
        return {**NULL_VISUAL, "kind": "timeline", "events": [{"y": y, "t": _cap(kws[0] if kws else "event")} for y in years[:3]]}
    if re.search(r"\b(leads? to|causes?|then|results? in|because|so that)\b", sentence, re.I) and len(kws) >= 3:
        return {**NULL_VISUAL, "kind": "flow", "steps": [_cap(k) for k in kws[:3]]}
    if i == 0:
        return {**NULL_VISUAL, "kind": "title", "emoji": _emoji(kws[0] if kws else ""), "caption": _cap(" & ".join(kws[:2]) or "Let's begin")}
    if len(kws) >= 3:
        return {**NULL_VISUAL, "kind": "icons", "items": [{"e": _emoji(w), "t": _cap(w)} for w in kws[:3]]}
    return {**NULL_VISUAL, "kind": "keywords", "words": [_cap(k) for k in kws]}


def _cloze_quiz(sents, n=2):
    all_kw = keywords(" ".join(sents), 12)
    out = []
    for s in sents:
        if len(out) >= n:
            break
        k = (keywords(s, 1) or [None])[0]
        if not k:
            continue
        distractors = [w for w in all_kw if w != k][len(out) * 2:len(out) * 2 + 2]
        if len(distractors) < 2:
            continue
        options = [_cap(w) for w in [k, *distractors]]
        ans = (len(s) + len(out)) % 3
        options[0], options[ans] = options[ans], options[0]
        out.append({"q": 'Fill the gap: "' + re.sub(rf"\b{re.escape(k)}\b", "_____", s, count=1, flags=re.I) + '"',
                    "options": options, "answer": ans, "explanation": f'The sentence is: "{s}"'})
    return out


def _checkpoint_for(text, pool, n_options=3):
    """Offline checkpoint: a fill-the-gap question on the scene's own key word."""
    q = _cloze_quiz(_sentences(text) or [text], 1)
    if not q:
        return None
    q = q[0]
    opts = q["options"][:max(2, n_options)]
    if q["answer"] >= len(opts):
        opts[-1], q["answer"] = q["options"][q["answer"]], len(opts) - 1
    right = opts[q["answer"]]
    return {"q": q["q"], "options": opts, "answer": q["answer"],
            "hint": "Listen to that scene again: which word did it keep coming back to?",
            "feedback_correct": f"Nice: \"{right}\" is the idea this scene is built on.",
            "feedback_incorrect": "Not quite. That word does appear in the lesson, but not in this sentence. Think about what this scene was explaining.",
            "explanation": q["explanation"]}


def _offline_storyboard(topic, source_text, band="9-12"):
    sents = _sentences(source_text)
    if len(sents) < 2:
        raise GenError("Offline mode needs some text to work from. Paste a few sentences or add a photo of the page, "
                       "or set ANTHROPIC_API_KEY to generate from the topic alone.", 400)
    n_scenes = max(3, min(6, -(-len(sents) // 2)))
    per = -(-len(sents) // n_scenes)
    scenes = []
    for i in range(0, len(sents), per):
        text = " ".join(sents[i:i + per])
        kws = keywords(text, 3)
        scenes.append({"heading": _cap(" and ".join(kws[:2]) or f"Part {len(scenes) + 1}"), "narration": text,
                       "visual": _visual_for(text, len(scenes))})
    scenes.append({"heading": "Recap",
                   "narration": f"To recap {topic}: {', '.join(keywords(source_text, 4))}. Now check yourself with a quick question.",
                   "visual": {**NULL_VISUAL, "kind": "keywords", "words": [_cap(k) for k in keywords(source_text, 5)]}})
    from .grades import BANDS
    n_checks, n_opts = BANDS[band]["checkpoints"], BANDS[band]["options"]
    for s in scenes:
        s["checkpoint"] = None
    for s in [s for s in scenes[1:-1]][:n_checks]:  # never the hook or the recap
        s["checkpoint"] = _checkpoint_for(s["narration"], source_text, n_opts)
    topic_words = [w for w in re.findall(r"[a-z0-9]+", topic.lower()) if w not in STOP]
    return {"title": _cap(topic), "subject": "General", "grade": band, "summary": sents[0][:140],
            "tags": list(dict.fromkeys([*topic_words, *keywords(source_text, 6)])),
            "learning_objectives": [f"Students will be able to explain {topic} in their own words."],
            "scenes": scenes, "quiz": _cloze_quiz(sents), "teacher_note": "", "needs_human_review": False}


def _offline_explainer(video, scene):
    if scene.get("deeper"):
        sc = [{"checkpoint": None, **s, "visual": {**NULL_VISUAL, **s["visual"]}} for s in scene["deeper"]]
        if len(sc) > 1 and not any(s.get("checkpoint") for s in sc):
            sc[1]["checkpoint"] = _checkpoint_for(sc[1]["narration"], scene["narration"])
        return {"title": f"Zoom in: {scene['heading']}", "misconception_addressed": "", "scenes": sc, "quiz": []}
    parts = [p for p in re.split(r"(?<=[.!?])\s+|,\s+(?=and |but |so |which )", scene["narration"]) if len(p.split()) > 2]
    scenes = [{"heading": f"Step back: {scene['heading']}" if i == 0 else f"Step {i + 1}", "narration": p,
               "visual": _visual_for(p, i + 1), "checkpoint": None} for i, p in enumerate(parts)]
    if len(scenes) > 1:
        scenes[1]["checkpoint"] = _checkpoint_for(scenes[1]["narration"], scene["narration"])
    scenes.append({"heading": "In one line", "narration": f"So the key idea of \"{scene['heading']}\" is: {parts[0] if parts else scene['narration']}",
                   "visual": {**NULL_VISUAL, "kind": "title", "emoji": "💡", "caption": scene["heading"]}, "checkpoint": None})
    return {"title": f"Zoom in: {scene['heading']}", "misconception_addressed": "", "scenes": scenes, "quiz": []}


# ---------------- public API ----------------
async def generate_video(topic: str, source_text: str, image: dict | None, band: str = "9-12",
                         assessment_mode: bool = False, fix_notes: str = ""):
    if _client:
        return await _claude_storyboard(topic, source_text, image, band, assessment_mode, fix_notes)
    return _offline_storyboard(topic, source_text, band)


async def generate_explainer(video: dict, scene_idx: int, question: str, band: str = "9-12", depth: int = 1,
                             fix_notes: str = ""):
    if _client:
        return await _claude_explainer(video, scene_idx, question, band, depth, fix_notes)
    return _offline_explainer(video, video["scenes"][scene_idx])
