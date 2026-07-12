.PHONY: up down logs test smoke demo

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
