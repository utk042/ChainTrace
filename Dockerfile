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

# Which dependency set to install. `full` pulls PyTorch + PyG + SHAP;
# `light` skips all three (see backend/requirements-light.txt) and is what a
# 512 MB host needs — the full set cannot even import inside that budget.
# Pair a light image with CT_LIGHT_MODE=true so the app selects the matching
# analysis backends.
ARG DEPS=full

RUN if [ "$DEPS" = "light" ]; then \
        pip install --no-cache-dir -r /app/requirements-light.txt; \
    else \
        pip install --no-cache-dir --extra-index-url https://download.pytorch.org/whl/cpu -r /app/requirements.txt; \
    fi

# Create data directories
RUN mkdir -p /app/data/sample /app/data/uploads /app/data/models

EXPOSE 8000

CMD ["sh", "-c", "uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}"]
