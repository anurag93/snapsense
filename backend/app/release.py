"""Server-side release decision (from the K-12 guardrail prompt pack).

Model outputs are inputs to this function, never the decision itself. A successful generation is not
evidence that content is safe.
"""
from __future__ import annotations

import os

POLICY = {
    # Stages that must report PASS before anything is saved or shown.
    "required_stages": ["input_moderation", "output_moderation", "answer_key", "content_review"],
    # Set REQUIRE_TEACHER_APPROVAL=1 to hold sensitive-topic content for a teacher (district setting).
    "needs_human_review": os.environ.get("REQUIRE_TEACHER_APPROVAL", "0") == "1",
}


def release_decision(checks: dict, policy: dict, human_review: str | None) -> str:
    """checks: stage -> 'PASS' | 'REVISE' | 'BLOCK' | 'NOT_VERIFIED' | 'ERROR'.
    A stage missing from checks counts as ERROR (bad JSON, timeout, provider outage)."""
    required = policy["required_stages"]
    statuses = [checks.get(stage, "ERROR") for stage in required]

    if "BLOCK" in statuses:
        return "BLOCK"        # show the decline message
    if "REVISE" in statuses:
        return "REGENERATE"   # at most 1 retry with the reviewer's fix notes, then BLOCK
    if any(s in ("NOT_VERIFIED", "ERROR") for s in statuses):
        return "HOLD"         # never fail open
    if policy.get("needs_human_review") and human_review != "APPROVED":
        return "HOLD"         # waits in the teacher or district review queue
    return "RELEASE"
