"""Floor-Plan Studio backend-api."""

import asyncio
import logging
import uuid
from contextlib import asynccontextmanager
from typing import Any

import httpx
from fastapi import FastAPI, HTTPException, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, Response, StreamingResponse
from plan_core import (
    Change,
    PlanGeometry,
    apply_ops,
    diff_geometries,
    parse_ops,
    register_hunk,
    validate,
)
from plan_core.export import render_png
from pydantic import BaseModel, Field
from sqlalchemy import select

from backend_api.config import AGENT_URL, STORAGE_DIR
from backend_api.db import Job, Plan, Review, Version, init_db, session
from backend_api.events import hub
from backend_api.seed import seed_if_empty

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("backend-api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    init_db()
    seed_if_empty()
    yield


app = FastAPI(title="floor-plan-studio backend-api", lifespan=lifespan)
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])


# ---------- helpers ----------


def _geo(version: Version) -> PlanGeometry:
    return PlanGeometry(**version.geometry)


def _versions(db, review_id: str) -> list[Version]:
    return list(
        db.execute(
            select(Version).where(Version.review_id == review_id).order_by(Version.n)
        ).scalars()
    )


def _serialize_diff(lines) -> list[dict[str, str]]:
    return [line.model_dump() for line in lines]


def _version_summary(v: Version) -> dict[str, Any]:
    geo = _geo(v)
    return {
        "n": v.n,
        "rent": v.rent,
        "changes": v.changes,
        "config": geo.summary_config(),
        "internal_area": round(geo.internal_area(), 1),
        "total_area": round(geo.total_area(), 1),
        "created_at": v.created_at.isoformat(),
    }


def _job_running(db, review_id: str) -> bool:
    return (
        db.execute(
            select(Job).where(Job.review_id == review_id, Job.status.in_(("queued", "running")))
        ).scalar_one_or_none()
        is not None
    )


# ---------- basic reads ----------


@app.get("/api/health")
def health() -> dict[str, bool]:
    return {"ok": True}


@app.get("/api/plans")
def list_plans() -> list[dict[str, Any]]:
    out: list[dict[str, Any]] = []
    with session() as db:
        for plan in db.execute(select(Plan).order_by(Plan.created_at)).scalars():
            review = db.execute(
                select(Review).where(Review.plan_id == plan.id)
            ).scalar_one_or_none()
            item: dict[str, Any] = {
                "plan_id": plan.id,
                "slug": plan.slug,
                "address": plan.address,
                "review_id": review.id if review else None,
            }
            if review:
                versions = _versions(db, review.id)
                if versions:
                    head = versions[-1]
                    item["head_n"] = head.n
                    item["rent"] = head.rent
                    item["config"] = _geo(head).summary_config()
            out.append(item)
    return out


@app.get("/api/reviews/{review_id}")
def get_review(review_id: str) -> dict[str, Any]:
    with session() as db:
        review = db.get(Review, review_id)
        if not review:
            raise HTTPException(404, "review not found")
        plan = db.get(Plan, review.plan_id)
        versions = _versions(db, review_id)
        return {
            "review_id": review.id,
            "plan": {"slug": plan.slug, "address": plan.address},
            "baseline_per_week": review.baseline_per_week,
            "comps": review.comps,
            "head_n": versions[-1].n if versions else None,
            "versions": [_version_summary(v) for v in versions],
        }


@app.get("/api/reviews/{review_id}/versions/{n}")
def get_version(review_id: str, n: int) -> dict[str, Any]:
    with session() as db:
        versions = _versions(db, review_id)
        byn = {v.n: v for v in versions}
        if n not in byn:
            raise HTTPException(404, f"version {n} not found")
        v = byn[n]
        geo = _geo(v)
        original = _geo(byn[0]) if 0 in byn else geo
        prev = byn.get(n - 1)
        return {
            "n": v.n,
            # serialize through the model so fixture-id backfill reaches the client
            "geometry": geo.model_dump(),
            "rent": v.rent,
            "changes": v.changes,
            "register": v.register,
            "diff_vs_original": _serialize_diff(diff_geometries(original, geo)),
            "diff_vs_prev": _serialize_diff(diff_geometries(_geo(prev), geo)) if prev else [],
            "config": geo.summary_config(),
        }


# ---------- comment jobs → agent ----------


class CommentTarget(BaseModel):
    type: str
    id: str
    t0: float | None = None
    t1: float | None = None


class CommentIn(BaseModel):
    text: str
    targets: list[CommentTarget] = Field(default_factory=list)


class CommentBatch(BaseModel):
    version_n: int
    comments: list[CommentIn]


@app.post("/api/reviews/{review_id}/comments", status_code=202)
async def submit_comments(review_id: str, batch: CommentBatch) -> dict[str, str]:
    with session() as db:
        review = db.get(Review, review_id)
        if not review:
            raise HTTPException(404, "review not found")
        versions = _versions(db, review_id)
        head = versions[-1]
        if head.n != batch.version_n:
            raise HTTPException(
                409, f"stale submit: head is v{head.n}, you commented on v{batch.version_n}"
            )
        if _job_running(db, review_id):
            raise HTTPException(409, "an agent job is already running for this review")
        job = Job(review_id=review_id, status="queued")
        db.add(job)
        db.commit()
        job_id = job.id
    asyncio.create_task(_run_job(job_id, review_id, batch))
    return {"job_id": job_id}


async def _run_job(job_id: str, review_id: str, batch: CommentBatch) -> None:
    def publish(event: dict[str, Any]) -> None:
        hub.publish(review_id, event)

    def set_status(status: str, error: str = "") -> None:
        with session() as db:
            job = db.get(Job, job_id)
            job.status = status
            job.error = error
            db.commit()

    try:
        set_status("running")
        publish({"type": "job.status", "job_id": job_id, "status": "running"})
        with session() as db:
            review = db.get(Review, review_id)
            versions = _versions(db, review_id)
            head = versions[-1]
            original = versions[0]
            head_geo = head.geometry
            context = {
                "property": _geo(head).property,
                "address": _geo(head).address,
                "baseline_per_week": review.baseline_per_week,
                "current_rent": head.rent.get("proposed_per_week"),
                "head_n": head.n,
                "next_change_id": f"c{sum(len(v.changes) for v in versions) + 1:02d}",
                "comps": review.comps,
            }

        async with httpx.AsyncClient(timeout=600) as client:
            resp = await client.post(
                f"{AGENT_URL}/apply",
                json={
                    "geometry": head_geo,
                    "comments": batch.model_dump()["comments"],
                    "context": context,
                },
            )
        if resp.status_code != 200:
            raise RuntimeError(f"agent error {resp.status_code}: {resp.text[:400]}")
        payload = resp.json()

        new_geo = PlanGeometry(**payload["geometry"])
        new_geo.meta["envelope"] = PlanGeometry(**original.geometry).meta.get(
            "envelope", new_geo.meta.get("envelope")
        )
        errors, warnings = validate(new_geo)
        if errors:
            raise RuntimeError("agent produced invalid geometry: " + "; ".join(errors[:4]))

        change = Change(**payload["change"])
        prev_geo = PlanGeometry(**head_geo)
        step_lines = diff_geometries(prev_geo, new_geo)
        hunk = register_hunk(change, step_lines)
        with session() as db:
            review = db.get(Review, review_id)
            head_now = _versions(db, review_id)[-1]
            new_rent = {
                "currency": "AUD",
                "baseline_per_week": review.baseline_per_week,
                "proposed_per_week": round(
                    float(head_now.rent.get("proposed_per_week", 0)) + change.rent_impact_per_week
                ),
            }
            version = Version(
                review_id=review_id,
                n=head_now.n + 1,
                geometry=new_geo.model_dump(),
                changes=[change.model_dump()],
                register=[hunk],
                rent=new_rent,
            )
            db.add(version)
            db.commit()
            new_n = version.n
        set_status("done")
        publish(
            {
                "type": "version.ready",
                "n": new_n,
                "job_id": job_id,
                "warnings": payload.get("warnings", []) + warnings,
            }
        )
    except Exception as exc:  # noqa: BLE001 — job boundary
        log.exception("job %s failed", job_id)
        set_status("error", str(exc))
        publish({"type": "job.error", "job_id": job_id, "error": str(exc)})


@app.get("/api/reviews/{review_id}/events")
async def events(review_id: str) -> StreamingResponse:
    q = hub.subscribe(review_id)

    async def stream():
        try:
            yield "event: hello\ndata: {}\n\n"
            while True:
                try:
                    payload = await asyncio.wait_for(q.get(), timeout=15)
                    yield f"data: {payload}\n\n"
                except TimeoutError:
                    yield ": keepalive\n\n"
        finally:
            hub.unsubscribe(review_id, q)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"},
    )


# ---------- direct human edits (no LLM) ----------


class EditBatch(BaseModel):
    version_n: int
    ops: list[dict[str, Any]]
    title: str = ""


@app.post("/api/reviews/{review_id}/edits", status_code=201)
def apply_edits(review_id: str, batch: EditBatch) -> dict[str, Any]:
    """Human edits: the same pipeline as the agent (apply_ops → validate → version),
    minus the LLM. Rent is carried unchanged and flagged for re-assessment."""
    try:
        ops = parse_ops(batch.ops)
    except Exception as exc:  # noqa: BLE001 — surface schema errors as 422
        raise HTTPException(422, f"invalid ops: {exc}") from exc
    if not ops:
        raise HTTPException(422, "no ops supplied")

    with session() as db:
        review = db.get(Review, review_id)
        if not review:
            raise HTTPException(404, "review not found")
        versions = _versions(db, review_id)
        head = versions[-1]
        if head.n != batch.version_n:
            raise HTTPException(
                409, f"stale edit: head is v{head.n}, you edited v{batch.version_n}"
            )
        if _job_running(db, review_id):
            raise HTTPException(409, "an agent job is running — wait for it to finish")

        head_geo = _geo(head)
        result = apply_ops(head_geo, ops)
        new_geo = result.geometry
        new_geo.meta["envelope"] = _geo(versions[0]).meta.get(
            "envelope", new_geo.meta.get("envelope")
        )
        errors, warnings = validate(new_geo)
        if errors:
            raise HTTPException(422, "; ".join(errors[:5]))

        change = Change(
            id=f"c{sum(len(v.changes) for v in versions) + 1:02d}",
            title=batch.title or "Manual geometry edit",
            rationale="Applied directly by the owner in the plan editor.",
            rent_impact_per_week=0,
            flags=["rent not re-assessed"],
            author="human",
        )
        hunk = register_hunk(change, diff_geometries(head_geo, new_geo))
        version = Version(
            review_id=review_id,
            n=head.n + 1,
            geometry=new_geo.model_dump(),
            changes=[change.model_dump()],
            register=[hunk],
            rent=dict(head.rent),
        )
        db.add(version)
        db.commit()
        new_n = version.n

    hub.publish(
        review_id,
        {
            "type": "version.ready",
            "n": new_n,
            "job_id": "",
            "warnings": result.warnings + warnings,
        },
    )
    return {"n": new_n, "warnings": result.warnings + warnings}


@app.delete("/api/reviews/{review_id}/versions/{n}")
def delete_version(review_id: str, n: int) -> dict[str, Any]:
    """Roll back by deleting the head version (n>0). n-1 becomes the editable head.
    Only the head is deletable, so history stays linear."""
    with session() as db:
        review = db.get(Review, review_id)
        if not review:
            raise HTTPException(404, "review not found")
        versions = _versions(db, review_id)
        head = versions[-1]
        if n != head.n:
            raise HTTPException(409, f"only the head (v{head.n}) can be deleted, not v{n}")
        if n == 0:
            raise HTTPException(422, "the original version cannot be deleted")
        if _job_running(db, review_id):
            raise HTTPException(409, "an agent job is running — wait for it to finish")
        db.delete(head)
        db.commit()
        new_head = n - 1
    hub.publish(
        review_id, {"type": "version.deleted", "n": n, "head_n": new_head}
    )
    return {"deleted": n, "head_n": new_head}


@app.get("/api/reviews/{review_id}/registers")
def get_registers(review_id: str) -> list[dict[str, Any]]:
    """All version registers in one round-trip (replaces the per-version N+1)."""
    with session() as db:
        if not db.get(Review, review_id):
            raise HTTPException(404, "review not found")
        return [{"n": v.n, "register": v.register} for v in _versions(db, review_id) if v.n > 0]


@app.get("/api/plans/{plan_id}/image")
def plan_image(plan_id: str) -> FileResponse:
    with session() as db:
        plan = db.get(Plan, plan_id)
        if not plan or not plan.image_path:
            raise HTTPException(404, "plan has no source image")
        path = plan.image_path
    media = "image/png" if path.endswith("png") else "image/jpeg"
    return FileResponse(path, media_type=media)


# ---------- exports & comps ----------


@app.get("/api/reviews/{review_id}/versions/{n}/export.png")
def export_png(review_id: str, n: int) -> FileResponse:
    with session() as db:
        versions = {v.n: v for v in _versions(db, review_id)}
        if n not in versions:
            raise HTTPException(404, f"version {n} not found")
        geo = _geo(versions[n])
    out = STORAGE_DIR / f"{review_id}-v{n:02d}.png"
    label = "Original plan" if n == 0 else f"Proposed plan (v{n:02d})"
    render_png(geo, out, label, geo.summary_config())
    return FileResponse(out, media_type="image/png", filename=f"propose_v{n:02d}_plan.png")


@app.get("/api/reviews/{review_id}/summary.md")
def summary_md(review_id: str) -> Response:
    with session() as db:
        review = db.get(Review, review_id)
        if not review:
            raise HTTPException(404, "review not found")
        plan = db.get(Plan, review.plan_id)
        versions = _versions(db, review_id)
    head = versions[-1]
    lines = [
        f"# SUMMARY — {plan.address or plan.slug}",
        "",
        f"Baseline **${review.baseline_per_week:.0f}/wk** → proposed "
        f"**${head.rent.get('proposed_per_week', 0):.0f}/wk** "
        f"(+${head.rent.get('proposed_per_week', 0) - review.baseline_per_week:.0f}/wk) "
        f"over {head.n} versions.",
        "",
        "| v | Change | Impact | Flags |",
        "|---|--------|--------|-------|",
    ]
    for v in versions[1:]:
        for c in v.changes:
            flags = " · ".join(c.get("flags", [])[:3])
            impact = c.get("rent_impact_per_week", 0)
            lines.append(f"| v{v.n:02d} | {c['title']} | +${impact:.0f}/wk | {flags} |")
    if review.comps:
        lines += ["", "## Rent evidence", ""]
        for comp in review.comps:
            lines.append(
                f"- {comp.get('address', '?')} — {comp.get('config', '?')} — "
                f"${comp.get('rent_per_week', '?')}/wk ({comp.get('source', 'seed')})"
            )
    lines += [
        "",
        "*Concept proposal — not architectural, planning, or financial advice.*",
    ]
    return Response("\n".join(lines), media_type="text/markdown")


@app.post("/api/reviews/{review_id}/comps/refresh")
async def refresh_comps(review_id: str) -> dict[str, Any]:
    with session() as db:
        review = db.get(Review, review_id)
        if not review:
            raise HTTPException(404, "review not found")
        versions = _versions(db, review_id)
        head = versions[-1]
        geo = _geo(head)
    async with httpx.AsyncClient(timeout=120) as client:
        resp = await client.post(
            f"{AGENT_URL}/comps",
            json={"address": geo.address, "config": geo.summary_config()},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"agent comps error: {resp.text[:300]}")
    comps = resp.json().get("comps", [])
    if comps:
        with session() as db:
            review = db.get(Review, review_id)
            review.comps = comps
            db.commit()
    return {"comps": comps}


# ---------- ingestion (P4) ----------


@app.post("/api/plans", status_code=201)
async def create_plan(file: UploadFile, address: str = "") -> dict[str, str]:
    plan_id = uuid.uuid4().hex
    suffix = (file.filename or "plan.png").split(".")[-1].lower()
    path = STORAGE_DIR / f"upload-{plan_id}.{suffix}"
    path.write_bytes(await file.read())
    slug = (address or file.filename or plan_id).lower().replace(" ", "-")[:100] or plan_id
    with session() as db:
        if db.execute(select(Plan).where(Plan.slug == slug)).scalar_one_or_none():
            slug = f"{slug}-{plan_id[:6]}"
        plan = Plan(id=plan_id, slug=slug, address=address, image_path=str(path))
        db.add(plan)
        db.commit()
    return {"plan_id": plan_id}


@app.post("/api/plans/{plan_id}/ingest")
async def ingest_plan(plan_id: str) -> dict[str, Any]:
    with session() as db:
        plan = db.get(Plan, plan_id)
        if not plan or not plan.image_path:
            raise HTTPException(404, "plan or image not found")
        image_path = plan.image_path
        address = plan.address
    import base64
    from pathlib import Path

    data = base64.b64encode(Path(image_path).read_bytes()).decode()
    media = "image/png" if image_path.endswith("png") else "image/jpeg"
    async with httpx.AsyncClient(timeout=600) as client:
        resp = await client.post(
            f"{AGENT_URL}/ingest",
            json={"image_b64": data, "media_type": media, "address": address},
        )
    if resp.status_code != 200:
        raise HTTPException(502, f"agent ingest error: {resp.text[:300]}")
    return resp.json()


class ApproveIn(BaseModel):
    geometry: dict[str, Any]
    baseline_per_week: float = 0


@app.post("/api/plans/{plan_id}/approve", status_code=201)
def approve_plan(plan_id: str, body: ApproveIn) -> dict[str, str]:
    geo = PlanGeometry(**body.geometry)
    geo.meta["envelope"] = list(geo.envelope())
    errors, _ = validate(geo)
    if errors:
        raise HTTPException(422, "; ".join(errors[:5]))
    with session() as db:
        plan = db.get(Plan, plan_id)
        if not plan:
            raise HTTPException(404, "plan not found")
        geo.property = plan.slug
        geo.address = geo.address or plan.address
        review = Review(plan_id=plan_id, baseline_per_week=body.baseline_per_week)
        db.add(review)
        db.flush()
        db.add(
            Version(
                review_id=review.id,
                n=0,
                geometry=geo.model_dump(),
                changes=[],
                register=[],
                rent={
                    "currency": "AUD",
                    "baseline_per_week": body.baseline_per_week,
                    "proposed_per_week": body.baseline_per_week,
                },
            )
        )
        db.commit()
        return {"review_id": review.id}
