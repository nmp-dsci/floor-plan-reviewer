"""Seed the 231-peats-ferry-rd review chain (original → v03) from app/seed fixtures."""

import json
import logging

from plan_core import Change, convert_v1, diff_geometries, register_hunk
from sqlalchemy import select

from backend_api.config import SEED_DIR
from backend_api.db import Plan, Review, Version, session

log = logging.getLogger(__name__)


def _match_lines(change: Change, lines: list) -> list:
    """Attribute step diff lines to a change by token overlap with its title/id."""
    tokens = {t.strip(".,()→+·'") for t in change.title.lower().replace("→", " ").split()}
    picked = []
    for line in lines:
        lid = line.id.lower()
        if any(tok and tok in lid for tok in tokens):
            picked.append(line)
    return picked


def seed_if_empty() -> None:
    meta_path = SEED_DIR / "changes_meta.json"
    if not meta_path.exists():
        log.warning("seed: no changes_meta.json in %s — skipping", SEED_DIR)
        return
    meta = json.loads(meta_path.read_text())
    slug = meta["property"]

    with session() as db:
        if db.execute(select(Plan).where(Plan.slug == slug)).scalar_one_or_none():
            return
        log.info("seeding %s", slug)

        original = convert_v1(json.loads((SEED_DIR / meta["original"]).read_text()))
        original.property = slug
        original.address = meta["address"]

        image = meta.get("image")
        plan = Plan(
            slug=slug,
            address=meta["address"],
            image_path=str(SEED_DIR / image) if image else None,
        )
        db.add(plan)
        db.flush()
        review = Review(
            plan_id=plan.id,
            baseline_per_week=meta["baseline_per_week"],
            comps=meta.get("comps", []),
        )
        db.add(review)
        db.flush()
        db.add(
            Version(
                review_id=review.id,
                n=0,
                geometry=original.model_dump(),
                changes=[],
                register=[],
                rent={
                    "currency": "AUD",
                    "baseline_per_week": meta["baseline_per_week"],
                    "proposed_per_week": meta["baseline_per_week"],
                },
                saved=True,  # the original is always kept
            )
        )

        last_entry = meta["versions"][-1] if meta["versions"] else None
        prev_geo = original
        for entry in meta["versions"]:
            geo = convert_v1(json.loads((SEED_DIR / entry["plan"]).read_text()))
            geo.property = slug
            geo.address = meta["address"]
            geo.meta["envelope"] = original.meta["envelope"]
            changes = [Change(**c) for c in entry["changes"]]
            step_lines = diff_geometries(prev_geo, geo)
            unclaimed = list(step_lines)
            hunks = []
            for change in changes:
                mine = _match_lines(change, unclaimed)
                for line in mine:
                    unclaimed.remove(line)
                hunks.append(register_hunk(change, mine))
            if unclaimed and hunks:
                first = hunks[0]
                extra = register_hunk(changes[0], unclaimed)
                first["lines"] = list(first["lines"]) + list(extra["lines"])
            db.add(
                Version(
                    review_id=review.id,
                    n=int(entry["n"]),
                    geometry=geo.model_dump(),
                    changes=[c.model_dump() for c in changes],
                    register=hunks,
                    rent={
                        "currency": "AUD",
                        "baseline_per_week": meta["baseline_per_week"],
                        "proposed_per_week": entry["rent"],
                    },
                    # bookmark the final curated proposal so it survives the first user edit
                    saved=(entry is last_entry),
                )
            )
            prev_geo = geo

        db.commit()
        log.info("seeded %s with %d versions", slug, len(meta["versions"]) + 1)
