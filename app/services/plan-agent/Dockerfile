FROM python:3.12-slim
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl gnupg \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && npm install -g @anthropic-ai/claude-code \
    && claude --version \
    && apt-get purge -y --auto-remove curl gnupg \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY packages/plan-core /app/packages/plan-core
COPY services/plan-agent /app/services/plan-agent
RUN pip install --no-cache-dir ./packages/plan-core ./services/plan-agent
EXPOSE 8091
CMD ["uvicorn", "plan_agent.main:app", "--host", "0.0.0.0", "--port", "8091"]
