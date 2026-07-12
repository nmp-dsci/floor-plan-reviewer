import os
from pathlib import Path

DATABASE_URL = os.environ.get(
    "DATABASE_URL", "postgresql+psycopg://studio:studio@localhost:5433/studio"
)
AGENT_URL = os.environ.get("AGENT_URL", "http://localhost:8091")
SEED_DIR = Path(os.environ.get("SEED_DIR", Path(__file__).resolve().parents[3] / "seed"))
STORAGE_DIR = Path(os.environ.get("STORAGE_DIR", "/tmp/floorplan-studio"))
STORAGE_DIR.mkdir(parents=True, exist_ok=True)
