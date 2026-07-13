.PHONY: up down logs test smoke demo demo-whats-new demo-tour demo-videos reseed e2e

up:
	docker compose up --build -d
	@echo ""
	@echo "Floor-Plan Studio is starting:"
	@echo "  app       → http://localhost:5175"
	@echo "  backend   → http://localhost:8090/api/health"
	@echo "  agent     → http://localhost:8091/health"

down:
	docker compose down

logs:
	docker compose logs -f

test:
	cd packages/plan-core && uv run pytest -q

smoke:
	@curl -sf http://localhost:8090/api/health >/dev/null && echo "backend  OK"
	@curl -sf http://localhost:8091/health >/dev/null && echo "agent    OK"
	@curl -sf http://localhost:5175 >/dev/null && echo "frontend OK"
	@curl -sf http://localhost:8090/api/plans | python3 -c "import json,sys; p=json.load(sys.stdin); print(f'plans    OK ({len(p)} seeded)')"

demo:
	cd demo && uv sync -q && uv run playwright install chromium && uv run python record_walkthrough.py

# Wipe Postgres + storage and wait for a pristine reseed (head = v03).
reseed:
	docker compose down -v
	docker compose up -d
	@printf "waiting for backend"; \
	until curl -sf http://localhost:8090/api/plans | grep -q peats; do printf "."; sleep 1; done; \
	echo " reseeded."

# The two narrated walkthroughs the product ships with. Each records against a
# freshly reseeded stack so the STORE→STUDY human edit always has a clean start.
demo-whats-new: reseed
	cd demo && uv sync -q && uv run playwright install chromium && uv run python record_whats_new.py

demo-tour: reseed
	cd demo && uv sync -q && uv run playwright install chromium && uv run python record_product_tour.py

demo-videos: demo-whats-new demo-tour
	@echo "both videos in app/demo/artifacts: whats_new.mp4 · product_tour.mp4"

# Browser-level half of the Feature Checks: real gestures on a throwaway sandbox
# review (drag/move/resize, wall drag, draws, shortcuts). Writes a PASS/FAIL report.
e2e:
	cd demo && uv sync -q && uv run playwright install chromium && uv run python e2e_feature_matrix.py
