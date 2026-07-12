FROM python:3.12-slim
WORKDIR /app
COPY packages/plan-core /app/packages/plan-core
COPY services/plan-agent /app/services/plan-agent
RUN pip install --no-cache-dir ./packages/plan-core ./services/plan-agent
EXPOSE 8091
CMD ["uvicorn", "plan_agent.main:app", "--host", "0.0.0.0", "--port", "8091"]
