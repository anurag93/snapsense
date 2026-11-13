"""ConceptReel API (FastAPI).

Guardrails follow the K-12 Guardrail Prompt Pack: grade bands (grades.py), prompts (prompts.py), word-list
moderation (safety.py) and a server-side release decision (release.py) before anything is saved or shown.

Run from backend/:  uvicorn app.main:app --port 3000
"""
from __future__ import annotations

import base64
import json
import logging
import os
import re
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.staticfiles import StaticFiles
from starlette.concurrency import run_in_threadpool

from . import generator as gen
from . import grades, safety, semantic, store, vectors, vision
from . import prompts as P
from .ranking import quality
from .release import POLICY, release_decision

log = logging.getLogger("conceptreel")
logging.basicConfig(level=logging.INFO, format="%(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)

PUBLIC_DIR = store.ROOT / "public"
UPLOAD_DIR = store.DB_PATH.parent / "uploads"
UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
EXT = {"image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/gif": "gif"}
COST = {"video": 30, "explainer": 10}
WEEKLY_TOKENS = 100
WEEK_MS = 7 * 86400000
DEMO_USERS = ["Maya", "Leo", "Priya"]


class ApiError(Exception):
    def __init__(self, message: str, status: int, code: str | None = None):
        super().__init__(message)
        self.status, self.code = status, code


def now_ms() -> int:
    return int(time.time() * 1000)


def week_start() -> int:
    d = datetime.now(timezone.utc)
    monday = (d - timedelta(days=d.weekday())).replace(hour=0, minute=0, second=0, microsecond=0)
    return int(monday.timestamp() * 1000)


def get_user(name) -> dict:
    db = store.load()
    key = str(name or "Maya").strip()[:24] or "Maya"
    if safety.categories(key):
        key = "Learner"
    u = db["users"].get(key)
    if not u:
        u = db["users"][key] = {"name": key, "balance": WEEKLY_TOKENS, "weekStart": week_start(), "spent": 0, "saved": 0,
                                "viewed": {}, "reactions": {}, "quizzed": {}}
    u.setdefault("checkpointed", {})
    if "grade" not in u:  # demo learners come pre-onboarded; anyone else picks up a grade at onboarding
        u["grade"] = grades.DEMO_GRADES.get(key)
    if now_ms() >= u["weekStart"] + WEEK_MS:
        u["balance"], u["weekStart"] = WEEKLY_TOKENS, week_start()
    return u


def band_of(u) -> str:
    return grades.band_for_grade(u.get("grade"))


def user_view(u):
    return {"name": u["name"], "balance": u["balance"], "weekly": WEEKLY_TOKENS, "resetsAt": u["weekStart"] + WEEK_MS,
            "spent": u["spent"], "saved": u["saved"], "grade": u.get("grade"),
            "gradeBand": band_of(u) if u.get("grade") else None}


def check_balance(u, amount):
    if u["balance"] < amount:
        raise ApiError(f"Not enough tokens: this costs {amount} and you have {u['balance']} left this week.", 402)


def spend(u, amount):
    check_balance(u, amount)
    u["balance"] -= amount
    u["spent"] += amount


def scene_seconds(sc) -> int:
    return max(4, round(len(sc["narration"].split()) / 2.6 + 1.2))


def card(v):
    emoji = next((s["visual"].get("emoji") for s in v["scenes"]
                  if s.get("visual") and s["visual"].get("kind") == "title" and s["visual"].get("emoji")), None)
    return {k: v.get(k) for k in ("id", "title", "subject", "grade", "style", "summary", "source", "createdBy", "createdAt")} | {
        "sceneCount": len(v["scenes"]), "emoji": emoji, "duration": sum(scene_seconds(s) for s in v["scenes"]),
        "sourceImage": v.get("sourceImage"), "stats": v["stats"], "quality": quality(v["stats"]),
        "gradeBand": grades.band_for_video(v), "checkpoints": sum(1 for s in v["scenes"] if s.get("checkpoint")),
    }


def hit(r):
    return card(r["video"]) | {
        "similarity": round(max(r["meaning"], r["graph"]) * 100), "meaning": round(r["meaning"] * 100),
        "graph": round(r["graph"] * 100), "rrf": round(r["rrf"] * 10000) / 10000, "ranks": r["ranks"],
        "strong": r["strong"], "matched": [list(m) for m in r["matches"] if m[2] >= 0.6][:4],
    }


def stop(where: str, user: str | None, message_key: str, categories: list[str] | None = None, status: int = 400):
    """Record a guardrail hit (no student text, no name) and stop with the pack's student-facing message."""
    db = store.load()
    db["metrics"]["blockedCount"] = db["metrics"].get("blockedCount", 0) + 1
    store.save_metrics()
    store.log_event({"t": now_ms(), "type": "blocked", "where": where, "reason": message_key,
                     "categories": categories or [], "promptVersion": P.PROMPT_VERSION})
    log.info("guardrail: %s at %s %s", message_key, where, ",".join(categories or []))
    raise ApiError(safety.MESSAGES[message_key], status, code=message_key)


def blocked(where: str, user: str | None, cats: list[str]):
    stop(where, user, "distress" if "self_harm" in cats else "language", cats)


def guard(where: str, user: str | None, *texts):
    cats = sorted({c for t in texts for c in safety.categories(t)})
    if cats:
        blocked(where, user, cats)


def find_video(vid):
    v = next((x for x in store.load()["videos"] if x["id"] == vid), None)
    if not v:
        raise ApiError("Not found", 404)
    return v


def load_upload(upload_id):
    if not re.fullmatch(r"[a-f0-9]{12}", str(upload_id or "")):
        return None
    meta_f = UPLOAD_DIR / f"{upload_id}.json"
    meta = json.loads(meta_f.read_text()) if meta_f.exists() else {}
    for media_type, ext in EXT.items():
        f = UPLOAD_DIR / f"{upload_id}.{ext}"
        if f.exists():
            return {"mediaType": media_type, "data": base64.b64encode(f.read_bytes()).decode(),
                    "url": f"/uploads/{upload_id}.{ext}", **meta}
    return None


def depth_of(v) -> int:
    """How many deep dives down this video is (a lesson is 0)."""
    d, cur = 0, v
    while cur.get("parentId"):
        d += 1
        cur = find_video(cur["parentId"])
    return d


async def search(*args, **kw):
    # Embeddings + spaCy are CPU work; keep the event loop free.
    return await run_in_threadpool(semantic.search, *args, **kw)


async def body(request: Request) -> dict:
    try:
        b = await request.json()
        return b if isinstance(b, dict) else {}
    except Exception:
        return {}


async def checked_generation(kind: str, make, band: str, source_text: str, assessment: bool, user: str):
    """Generate → code checks → independent review (Prompt 5) → release_decision. One retry with the reviewer's
    fix notes; anything else fails closed. Returns (content, review)."""
    fix_notes = ""
    for attempt in (1, 2):
        try:
            out = await make(fix_notes)
        except gen.Declined as e:
            key = {"declined": "declined", "at_limit": "deep_dive_limit", "redirect": "off_topic"}[e.kind]
            stop(kind, user, key)
        except safety.Unsafe as e:
            blocked(kind, user, e.categories)
        checks = {"input_moderation": "PASS"}  # inputs were checked before generation
        cats = safety.categories(safety.storyboard_text(out))
        checks["output_moderation"] = "BLOCK" if cats else "PASS"
        problems = gen.validate_questions(out)
        checks["answer_key"] = "REVISE" if problems else "PASS"
        rv = {"status": "PASS", "fix_notes": "", "failed": [], "needs_human_review": False, "teacher_note": ""}
        if gen.mode() == "claude" and REVIEW:
            try:
                rv = await gen.review(band, source_text, out, assessment)
            except Exception as e:  # reviewer down or invalid JSON → not verified → HOLD
                log.error("review failed: %s", e)
                rv = {**rv, "status": "ERROR"}
        checks["content_review"] = rv["status"]
        needs_review = bool(out.get("needs_human_review") or rv["needs_human_review"])
        decision = release_decision(checks, {**POLICY, "needs_human_review": POLICY["needs_human_review"] and needs_review}, None)
        store.log_event({"t": now_ms(), "type": "release", "where": kind, "decision": decision, "attempt": attempt,
                         "checks": checks, "failed": rv["failed"], "band": band, "promptVersion": P.PROMPT_VERSION,
                         "model": gen.MODEL if gen.mode() == "claude" else "offline"})
        if decision == "RELEASE":
            return out, {**rv, "needs_human_review": needs_review}
        if decision == "REGENERATE" and attempt == 1:
            fix_notes = "\n".join([rv["fix_notes"], *problems]).strip()
            continue
        if decision == "BLOCK" and cats:
            blocked(kind, user, cats)
        stop(kind, user, {"BLOCK": "declined", "REGENERATE": "declined", "HOLD": "hold"}[decision]
             if not (decision == "HOLD" and needs_review and POLICY["needs_human_review"]) else "held_for_teacher")


app = FastAPI(title="ConceptReel")
REVIEW = os.environ.get("REVIEW", "on") != "off"


@app.exception_handler(ApiError)
async def _api_error(_, e: ApiError):
    return JSONResponse({"error": str(e), "code": e.code}, status_code=e.status)


@app.exception_handler(gen.GenError)
async def _gen_error(_, e: gen.GenError):
    log.error("generation: %s", e)
    msg = str(e) if getattr(e, "status", 500) < 500 else safety.MESSAGES["hold"]
    return JSONResponse({"error": msg}, status_code=getattr(e, "status", 500))


@app.exception_handler(Exception)
async def _any_error(_, e: Exception):
    log.exception("unhandled: %s", e)
    return JSONResponse({"error": safety.MESSAGES["hold"]}, status_code=500)


@app.on_event("startup")
def _startup():
    vectors.connect()
    info = semantic.index_all(store.load()["videos"])
    store.save_all()
    log.info("Indexed %s videos: %s concepts in the knowledge graph (%s parsed, rest loaded), embeddings %s, "
             "vectors in %s (%s embedded), %s ms. Data in %s. Generator: %s (review %s, prompts %s)", info["videos"],
             info["concepts"], info["parsed"], "on" if info["embeddings"] else "OFF (run python -m app.fetch_model)",
             info["vectors"], info["embedded"], info["ms"], store.backend(), gen.mode(),
             "on" if REVIEW and gen.mode() == "claude" else "code checks only", P.PROMPT_VERSION)


@app.on_event("shutdown")
def _shutdown():
    vectors.close()


@app.get("/api/state")
def state(user: str | None = None):
    db = store.load()
    u = get_user(user)
    store.save_user(u)
    roots = [v for v in db["videos"] if not v.get("parentId")]
    return {"user": user_view(u), "demoUsers": DEMO_USERS, "mode": gen.mode(), "cost": COST,
            "grades": grades.GRADES, "bands": {k: {"ages": b["ages"], "maxDepth": b["max_depth"]} for k, b in grades.BANDS.items()},
            "storage": {"data": store.backend(), "vectors": "weaviate" if vectors.enabled() else "memory"},
            "metrics": db["metrics"] | {"videos": len(roots), "explainers": len(db["videos"]) - len(roots)}}


@app.post("/api/user/grade")
async def set_grade(request: Request):
    """Onboarding: the grade a learner is assigned (in production by the school or teacher account)."""
    b = await body(request)
    u = get_user(b.get("user"))
    g = str(b.get("grade") or "").strip().upper()
    if g not in grades.GRADES:
        raise ApiError("Pick a grade from K to 12.", 400)
    u["grade"] = g
    store.save_user(u)
    return {"user": user_view(u)}


def visible(v, band: str | None) -> bool:
    """Learners only see lessons made for their grade band or younger, and nothing held for a teacher."""
    if v.get("heldForReview"):
        return False
    return band is None or grades.ORDER.index(grades.band_for_video(v)) <= grades.ORDER.index(band)


@app.get("/api/trending")
def trending(user: str | None = None):
    band = band_of(get_user(user)) if user else None
    lst = sorted((card(v) for v in store.load()["videos"] if not v.get("parentId") and visible(v, band)),
                 key=lambda c: -c["quality"]["score"])
    return {"videos": lst[:8]}


@app.get("/api/search")
async def search_route(q: str = "", user: str | None = None):
    q = q[:300]
    cats = safety.categories(q)
    if cats:
        try:
            blocked("search", None, cats)
        except ApiError as e:  # search answers 200 with a notice so the results page can show it
            return {"query": q, "strongMatch": False, "queryConcepts": [], "results": [], "blocked": str(e),
                    "code": e.code, "fusion": {"k": semantic.RRF_K, "weights": semantic.LIST_WEIGHTS}}
    band = band_of(get_user(user)) if user else None
    videos = store.load()["videos"]
    pool = [v for v in videos if visible(v, band)]
    out = await search(q, pool, band=band)
    hidden = 0
    if band:  # tell the learner when relevant lessons exist for older grades
        older = [v for v in videos if not visible(v, band) and not v.get("parentId")]
        if older:
            hidden = len((await search(q, older))["results"])
    return {"query": q, "strongMatch": any(r["strong"] for r in out["results"]),
            "queryConcepts": out["query_graph"]["nodes"], "gradeBand": band, "hiddenForOlderGrades": hidden,
            "fusion": {"k": semantic.RRF_K, "weights": {**semantic.LIST_WEIGHTS, **({"grade": semantic.GRADE_WEIGHT} if band else {})}},
            "results": [hit(r) for r in out["results"]]}


@app.get("/api/videos/{vid}")
async def video(vid: str, user: str | None = None):
    db = store.load()
    v = find_video(vid)
    band = band_of(get_user(user)) if user else None
    explainers = [card(x) | {"parentScene": x.get("parentScene")} for x in db["videos"] if x.get("parentId") == v["id"]]
    root = find_video(v.get("parentId") or v["id"])
    out = await search(f"{root['title']}. {root.get('summary') or ''}", [x for x in db["videos"] if visible(x, band)],
                       exclude=root["id"], band=band)
    alternatives = [hit(r) for r in out["results"] if r["meaning"] >= 0.5 or r["graph"] >= 0.5]
    depth = depth_of(v)
    return {"video": v | {"quality": quality(v["stats"]), "sceneSeconds": [scene_seconds(s) for s in v["scenes"]],
                          "conceptMap": semantic.concept_map(v["id"]), "gradeBand": grades.band_for_video(v),
                          "depth": depth},
            "explainers": explainers, "alternatives": alternatives, "parent": card(root) if v.get("parentId") else None,
            "canGoDeeper": band is None or depth < grades.BANDS[band]["max_depth"],
            "freeTextQuestions": band is None or grades.BANDS[band]["free_text"]}


@app.post("/api/videos/{vid}/event")
async def event(vid: str, request: Request):
    db = store.load()
    v = find_video(vid)
    b = await body(request)
    u = get_user(b.get("user"))
    s, typ = v["stats"], b.get("type")
    num = lambda x: int(x) if isinstance(x, (int, float)) or (isinstance(x, str) and x.isdigit()) else 0
    if typ == "view":
        s["views"] += 1
        if v["id"] not in u["viewed"]:
            u["viewed"][v["id"]] = now_ms()
            saved = COST["explainer"] if v.get("parentId") else COST["video"]  # each reuse = a generation nobody paid for
            if v.get("createdBy") != u["name"]:
                u["saved"] += saved
                db["metrics"]["tokensSaved"] += saved
                db["metrics"]["reuseCount"] += 1
    elif typ == "complete":
        s["completions"] += 1
    elif typ in ("like", "dislike"):
        prev = u["reactions"].get(v["id"])
        if prev:
            s[prev + "s"] -= 1
        if prev == typ:
            del u["reactions"][v["id"]]
        else:
            u["reactions"][v["id"]] = typ
            s[typ + "s"] += 1
    elif typ == "quiz":
        if v["id"] not in u["quizzed"]:
            u["quizzed"][v["id"]] = True
            total = max(0, num(b.get("total")))
            correct = min(total, max(0, num(b.get("correct"))))
            s["quizAttempts"] += total
            s["quizCorrect"] += correct
    elif typ == "checkpoint":
        # First-try result per learner per scene feeds quiz accuracy; a miss also marks the scene as confusing.
        idx = max(0, min(len(v["scenes"]) - 1, num(b.get("scene"))))
        done = u["checkpointed"].setdefault(v["id"], [])
        if idx not in done:
            done.append(idx)
            correct = bool(b.get("correct"))
            cp = s.setdefault("checkpoints", {}).setdefault(str(idx), {"attempts": 0, "correct": 0})
            cp["attempts"] += 1
            cp["correct"] += correct
            s["quizAttempts"] += 1
            s["quizCorrect"] += correct
            if not correct:
                s.setdefault("confusedScenes", {})
                s["confusedScenes"][str(idx)] = s["confusedScenes"].get(str(idx), 0) + 1
    else:
        raise ApiError("Unknown event", 400)
    store.save_video(v)
    store.save_user(u)
    store.save_metrics()
    store.log_event({"t": now_ms(), "user": u["name"], "video": v["id"], "type": typ})
    return {"stats": s, "quality": quality(s), "reaction": u["reactions"].get(v["id"]), "user": user_view(u)}


@app.post("/api/read-image")
async def read_image(request: Request):
    """Prompt 1 intake screen, then look for saved videos on that concept before generating anything."""
    b = await body(request)
    u = get_user(b.get("user"))
    band = band_of(u)
    m = re.match(r"^data:(image/[a-z]+);base64,(.+)$", str(b.get("image") or ""), re.S)
    if not m or m.group(1) not in vision.MEDIA_TYPES:
        raise ApiError("Please upload a JPG, PNG, WebP or GIF image.", 400)
    media_type, data = m.groups()
    if len(data) > 11 * 1024 * 1024:
        raise ApiError("That image is too large. Try a smaller photo.", 413)
    raw = base64.b64decode(data)
    try:
        reading = await vision.read_image(data, media_type, raw, band)
    except safety.Unsafe as e:
        blocked("photo", u["name"], e.categories)
    if reading.get("student_distress_signal"):
        stop("photo", u["name"], "distress")  # the district escalation hook would go here
    if reading.get("injection_attempt"):
        store.log_event({"t": now_ms(), "type": "injection_attempt", "where": "photo"})
    decision = reading["decision"]
    if decision == "block":
        stop("photo", u["name"], "not_study_material" if reading.get("educational") is False else "blocked")
    if decision == "illegible" or not reading["readable"]:
        if gen.mode() == "offline":
            raise ApiError("Couldn't make out any text in that photo. Offline mode reads printed text; handwriting and diagrams "
                           "need the Claude API key. Try a sharper, well-lit photo.", 422, code="illegible")
        stop("photo", u["name"], "illegible", status=422)
    guard("photo", u["name"], reading["topic"], reading["text"])
    upload_id = store.new_id()
    (UPLOAD_DIR / f"{upload_id}.{EXT[media_type]}").write_bytes(raw)
    meta = {"assessment": decision == "assessment_mode", "pii": bool(reading.get("pii"))}
    (UPLOAD_DIR / f"{upload_id}.json").write_text(json.dumps(meta))
    out = await search(f"{reading['topic']}. {reading['text'][:1000]}", [v for v in store.load()["videos"] if visible(v, band)],
                       band=band)
    notices = [safety.MESSAGES[k] for k, on in (("assessment", meta["assessment"]), ("pii", meta["pii"])) if on]
    return {"uploadId": upload_id, "imageUrl": f"/uploads/{upload_id}.{EXT[media_type]}", "kind": reading["kind"],
            "topic": reading["topic"], "text": reading["text"], "mode": reading["mode"], "notices": notices,
            "assessment": meta["assessment"], "strongMatch": any(r["strong"] for r in out["results"])}


@app.post("/api/generate")
async def generate(request: Request):
    db = store.load()
    b = await body(request)
    u = get_user(b.get("user"))
    band = band_of(u)
    topic = str(b.get("topic") or "").strip()[:200]
    source_text = str(b.get("sourceText") or "").strip()[:6000]
    image = load_upload(b.get("uploadId")) if b.get("uploadId") else None
    if b.get("uploadId") and not image:
        raise ApiError("That photo has expired. Please add it again.", 400)
    if not topic and not image:
        raise ApiError("Tell us which concept you want explained.", 400)
    topic = topic or "My notes"
    guard("generate", u["name"], topic, source_text)
    check_balance(u, COST["video"])
    assessment = bool(image and image.get("assessment"))
    sb, rv = await checked_generation(
        "generate", lambda fix: gen.generate_video(topic, source_text, image, band, assessment, fix),
        band, source_text, assessment, u["name"])
    spend(u, COST["video"])  # only after the content was released
    sb.pop("needs_human_review", None)
    v = {"id": store.new_id(), "source": "generated", "createdBy": u["name"], "createdAt": now_ms(), "parentId": None,
         "parentScene": None, "style": "From a photo" if image else "From your notes" if source_text else "Story", **sb,
         "grade": band, "gradeBand": band, "teacherNote": "\n".join(x for x in (sb.pop("teacher_note", ""), rv["teacher_note"]) if x),
         "needsHumanReview": rv["needs_human_review"], "learningObjectives": sb.pop("learning_objectives", []),
         # A photo with personal details is used to make the lesson but never shown to other learners.
         "sourceImage": image["url"] if image and not image.get("pii") else None, "stats": store.empty_stats()}
    v.pop("teacher_note", None)
    v.pop("learning_objectives", None)
    db["videos"].append(v)
    await run_in_threadpool(semantic.index_video, v)  # knowledge graph + embeddings from the new transcript
    db["metrics"]["generatedCount"] += 1
    u["viewed"][v["id"]] = now_ms()
    store.save_video(v)
    store.save_user(u)
    store.save_metrics()
    return {"video": card(v), "user": user_view(u)}


@app.post("/api/videos/{vid}/explain")
async def explain(vid: str, request: Request):
    db = store.load()
    v = find_video(vid)
    b = await body(request)
    u = get_user(b.get("user"))
    band = band_of(u)
    try:
        idx = int(b.get("sceneIndex") or 0)
    except (TypeError, ValueError):
        idx = 0
    idx = max(0, min(len(v["scenes"]) - 1, idx))
    # Grades K-5 have no free-text questions (topic picker only), per the grade-band table.
    question = str(b.get("question") or "").strip()[:300] if grades.BANDS[band]["free_text"] else ""
    guard("deep dive question", u["name"], question)
    depth = depth_of(v) + 1
    if depth > grades.BANDS[band]["max_depth"]:  # enforced in code, not only in the prompt
        stop("deep dive", u["name"], "deep_dive_limit")
    s = v["stats"]
    s["explainRequests"] += 1
    s.setdefault("confusedScenes", {})
    s["confusedScenes"][str(idx)] = s["confusedScenes"].get(str(idx), 0) + 1

    # Someone already asked about this exact part? Reuse it for free.
    existing = None if b.get("forceNew") else next(
        (x for x in db["videos"] if x.get("parentId") == v["id"] and x.get("parentScene") == idx and visible(x, band)), None)
    if existing:
        db["metrics"]["explainersReused"] += 1
        store.save_video(v)
        store.save_metrics()
        return {"video": card(existing), "reused": True, "user": user_view(u)}
    check_balance(u, COST["explainer"])
    ex, rv = await checked_generation(
        "deep dive", lambda fix: gen.generate_explainer(v, idx, question, band, depth, fix),
        band, "", False, u["name"])
    spend(u, COST["explainer"])
    child = {"id": store.new_id(), "source": "explainer", "createdBy": u["name"], "createdAt": now_ms(), "parentId": v["id"],
             "parentScene": idx, "subject": v.get("subject"), "grade": band, "gradeBand": band, "style": "Deep dive",
             "summary": f"A slower look at \"{v['scenes'][idx]['heading']}\"", "tags": v.get("tags"), **ex,
             "teacherNote": rv["teacher_note"], "needsHumanReview": rv["needs_human_review"], "stats": store.empty_stats()}
    db["videos"].append(child)
    await run_in_threadpool(semantic.index_video, child)
    db["metrics"]["explainersGenerated"] += 1
    u["viewed"][child["id"]] = now_ms()
    store.save_video(v)
    store.save_video(child)
    store.save_user(u)
    store.save_metrics()
    return {"video": card(child), "reused": False, "user": user_view(u)}


@app.post("/api/reset")
async def reset():
    db = store.reset()
    await run_in_threadpool(semantic.index_all, db["videos"])
    store.save_all()
    return {"ok": True}


app.mount("/uploads", StaticFiles(directory=UPLOAD_DIR), name="uploads")
app.mount("/", StaticFiles(directory=PUBLIC_DIR, html=True), name="public")
