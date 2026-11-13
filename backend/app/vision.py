"""Reading a photo the learner snapped: a textbook page, a diagram, a screenshot or handwritten notes.

With an API key, Claude reads it (handwriting and diagrams included). Offline, RapidOCR (ONNX models
bundled in the pip package, no download) reads printed text. Either way we get a topic + transcription,
used to look for saved videos before spending tokens on a new one.
"""
from __future__ import annotations

import io
import re
from typing import List, Literal

from pydantic import BaseModel

from . import generator as gen
from . import safety

MEDIA_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}


class Pii(BaseModel):
    type: Literal["face", "full_name", "address", "phone", "email", "student_id", "school_name", "signature", "other"]
    location: str


class UnsafeItem(BaseModel):
    category: Literal["sexual", "graphic_violence", "self_harm", "hate", "drugs_alcohol", "weapons", "other"]
    educational_context: bool
    severity: Literal["low", "medium", "high"]


class ImageReading(BaseModel):
    """Prompt 1 (intake screen) plus the transcription we need to find a lesson."""
    is_educational_material: bool
    subject: Literal["math", "science", "ela", "social_studies", "language", "arts", "health", "other", "unknown"]
    is_graded_assessment: bool
    pii_detected: List[Pii]
    unsafe_content: List[UnsafeItem]
    student_distress_signal: bool
    injection_attempt: bool
    legible: bool
    kind: Literal["textbook", "diagram", "handwriting", "screenshot", "other"]
    topic: str
    text: str
    reason: str


def decide(r: dict) -> str:
    """Code (not the model) decides, using the pack's rules. Most cautious outcome wins."""
    unsafe = r.get("unsafe_content") or []
    if (not r.get("is_educational_material", True)
            or any(u["severity"] == "high" or not u["educational_context"] for u in unsafe)):
        return "block"
    if not r.get("legible", True):
        return "illegible"
    if r.get("is_graded_assessment"):
        return "assessment_mode"
    if r.get("pii_detected"):
        return "redact_then_proceed"
    return "proceed"


async def _claude_read(data: str, media_type: str, band: str) -> dict:
    from . import prompts as P
    res = await gen.client().messages.parse(
        model=gen.MODEL, max_tokens=16000, output_config={"effort": "low"}, output_format=ImageReading,
        system=P.intake(band),
        messages=[{"role": "user", "content": [
            {"type": "image", "source": {"type": "base64", "media_type": media_type, "data": data}},
            {"type": "text", "text": "Screen and transcribe this photo."},
        ]}],
    )
    if res.stop_reason == "refusal":
        return {"decision": "block", "kind": "other", "topic": "", "text": "", "readable": False,
                "student_distress_signal": False, "pii": False, "assessment": False}
    if res.parsed_output is None:
        raise gen.GenError("Could not read the image")
    r = res.parsed_output.model_dump()
    return {"decision": decide(r), "kind": r["kind"], "topic": r["topic"], "text": r["text"],
            "readable": r["legible"] and r["is_educational_material"], "subject": r["subject"],
            "educational": r["is_educational_material"],
            "student_distress_signal": r["student_distress_signal"], "injection_attempt": r["injection_attempt"],
            "pii": bool(r["pii_detected"]), "assessment": r["is_graded_assessment"]}


_ocr = None


def _ocr_engine():
    global _ocr
    if _ocr is None:
        from rapidocr_onnxruntime import RapidOCR
        _ocr = RapidOCR()
    return _ocr


def _respace(text: str) -> str:
    """The bundled recognizer is a Chinese+English model that drops spaces between English words
    ("CellularRespiration"). Put them back with a word-frequency splitter."""
    import wordninja
    text = re.sub(r"(?<=[,;:!?)])(?=[A-Za-z(])|(?<=\d)(?=[A-Za-z]{3,})|(?<=[A-Za-z]{3})(?=\d)", " ", text)
    text = re.sub(r"(?<=[a-z])\.(?=[A-Z])", ". ", text)
    return re.sub(r"[A-Za-z']{4,}", lambda m: " ".join(wordninja.split(m.group())), text)


def _lines_to_paragraphs(boxes) -> list[str]:
    """RapidOCR returns text boxes; re-join them top-to-bottom into paragraphs."""
    lines = []
    for box, text, conf in boxes:
        ys = [p[1] for p in box]
        xs = [p[0] for p in box]
        lines.append({"top": min(ys), "bottom": max(ys), "left": min(xs), "right": max(xs), "text": _respace(text.strip()), "conf": float(conf)})
    lines.sort(key=lambda l: (l["top"], l["left"]))
    paras, cur, prev = [], "", None
    full = max((l["right"] for l in lines), default=0)
    for l in lines:
        height = l["bottom"] - l["top"]
        # New paragraph after a big vertical gap, or when the previous line stopped well short of the margin.
        if prev is not None and (l["top"] - prev["bottom"] > height * 0.9 or prev["right"] < full * 0.7):
            paras.append(cur)
            cur = ""
        cur = (cur[:-1] + l["text"]) if cur.endswith("-") else (f"{cur} {l['text']}".strip())
        prev = l
    if cur:
        paras.append(cur)
    return paras


def _guess_topic(paras: list[str]) -> str:
    for p in paras[:5]:
        t = re.sub(r"^[\d.\s]+", "", p).strip()
        if 1 <= len(t.split()) <= 6 and not re.search(r"chapter|unit|page|lesson", t, re.I) \
                and not re.search(r"[.!?]$", t) and re.search(r"[a-z]", t, re.I):
            return t
    counts = {}
    for w in re.findall(r"[a-z]{5,}", " ".join(paras).lower()):
        counts[w] = counts.get(w, 0) + 1
    top = sorted(counts.items(), key=lambda kv: -kv[1])[:2]
    return " ".join(w for w, _ in top) or "My notes"


def _offline_read(raw: bytes) -> dict:
    from PIL import Image
    import numpy as np
    img = Image.open(io.BytesIO(raw)).convert("RGB")
    boxes, _ = _ocr_engine()(np.array(img))
    boxes = boxes or []
    paras = _lines_to_paragraphs(boxes)
    text = "\n\n".join(paras)
    conf = sum(float(b[2]) for b in boxes) / len(boxes) if boxes else 0
    readable = conf > 0.6 and len(re.sub(r"\s", "", text)) > 25
    topic = _guess_topic(paras)
    body = [p for p in paras if re.sub(r"^[\d.\s]+", "", p).strip() != topic and not re.match(r"chapter\b", p, re.I)]
    return {"kind": "textbook", "topic": topic, "text": "\n\n".join(body) or text, "readable": readable,
            "confidence": round(conf * 100), "decision": "proceed" if readable else "illegible",
            "student_distress_signal": False, "pii": False, "assessment": False}


async def read_image(data: str, media_type: str, raw: bytes, band: str = "9-12") -> dict:
    if gen.mode() == "claude":
        return {**(await _claude_read(data, media_type, band)), "mode": "claude"}
    from starlette.concurrency import run_in_threadpool
    return {**(await run_in_threadpool(_offline_read, raw)), "mode": "offline"}
