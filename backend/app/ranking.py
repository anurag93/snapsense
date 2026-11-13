"""Ranking by how other learners interacted with a video.

Each signal is smoothed with a prior so a brand-new video isn't ranked 100% or 0%. The learning
signal (quiz accuracy) carries the most weight: the goal is understanding, not watch time.
"""

def _pct(x: float) -> int:
    return int(x * 100 + 0.5)


WEIGHTS = {"quiz": 0.4, "completion": 0.25, "likes": 0.2, "clarity": 0.15}


def quality(stats: dict) -> dict:
    s = stats or {}
    views = s.get("views", 0)
    quiz = (s.get("quizCorrect", 0) + 3) / (s.get("quizAttempts", 0) + 5)
    completion = (s.get("completions", 0) + 3) / (views + 5)
    likes = (s.get("likes", 0) + 3) / (s.get("likes", 0) + s.get("dislikes", 0) + 5)
    # Clarity: fewer "explain this part" requests per view = clearer video.
    confusion = min(1.0, (s.get("explainRequests", 0) + 1) / (views + 5) * 3)
    clarity = 1 - confusion
    score = (WEIGHTS["quiz"] * quiz + WEIGHTS["completion"] * completion
             + WEIGHTS["likes"] * likes + WEIGHTS["clarity"] * clarity)
    return {
        "score": _pct(score),
        # Below a handful of views the score is mostly prior, so the UI labels it "New" instead.
        "confident": views >= 5,
        "breakdown": {"quiz": _pct(quiz), "completion": _pct(completion),
                      "likes": _pct(likes), "clarity": _pct(clarity)},
    }
