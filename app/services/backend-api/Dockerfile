FROM python:3.12-slim
WORKDIR /app
COPY packages/plan-core /app/packages/plan-core
COPY services/backend-api /app/services/backend-api
RUN pip install --no-cache-dir ./packages/plan-core ./services/backend-api
COPY seed /app/seed
EXPOSE 8090
CMD ["uvicorn", "backend_api.main:app", "--host", "0.0.0.0", "--port", "8090"]
