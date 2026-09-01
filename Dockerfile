FROM python:3.11-slim

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y --no-install-recommends \
    build-essential \
    && rm -rf /var/lib/apt/lists/*

# Copy build context to temporary staging
COPY . /tmp/build/

# Normalize directory structure whether context is repo root or backend folder
RUN if [ -d /tmp/build/backend ]; then \
        cp -a /tmp/build/backend/. /app/; \
    else \
        cp -a /tmp/build/. /app/; \
    fi && \
    rm -rf /tmp/build

# Install dependencies using CPU-optimized PyTorch wheels
RUN pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /app/requirements.txt

# Create data directories
RUN mkdir -p /app/data/sample /app/data/uploads /app/data/models

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
