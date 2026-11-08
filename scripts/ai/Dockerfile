FROM python:3.12-slim
WORKDIR /app
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 PYTHONPATH=/app/src
COPY requirements-lock.txt ./
RUN pip install --no-cache-dir -r requirements-lock.txt && useradd --uid 10001 --create-home eris
COPY src/eris_ai ./src/eris_ai
COPY artifacts/mexwell_rf12_demo_v1/bundle.joblib ./artifacts/mexwell_rf12_demo_v1/bundle.joblib
USER eris
EXPOSE 8000
CMD ["python", "-m", "uvicorn", "eris_ai.api:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
