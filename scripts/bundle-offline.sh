#!/usr/bin/env bash
#
# Build an install bundle for a machine with no internet.
#
# Everything else in this repo is offline at *run* time; installing it is not.
# `pip install` and `npm ci` both reach out, so a genuinely air-gapped machine
# cannot follow the normal setup at all. This runs on a connected machine and
# produces a directory (and tarball) that carries the pieces with it: the
# already-built frontend, every Python wheel resolved ahead of time, the
# backend source, and an installer that uses no index.
#
# Usage:
#   scripts/bundle-offline.sh [--full] [--out DIR]
#
#   --full   Include PyTorch, PyTorch Geometric and SHAP (~2.5 GB installed).
#            The default is the light set (~120 MB): a PCA linear autoencoder
#            instead of the neural one, structural embeddings instead of
#            Node2Vec, reconstruction error instead of SHAP. Everything else
#            — ingestion, the graph, clustering, the structural detectors,
#            risk propagation and the whole API — is identical.
#   --out    Where to write the bundle. Default: dist-offline/
#
# IMPORTANT: wheels are platform- and Python-specific. Build the bundle on a
# machine whose OS, CPU architecture and Python minor version match the target,
# or the installer will find no wheel it can use. `install.sh` checks this and
# says so rather than failing halfway through.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PROFILE="light"
OUT="$ROOT/dist-offline"

while [ $# -gt 0 ]; do
  case "$1" in
    --full) PROFILE="full"; shift ;;
    --light) PROFILE="light"; shift ;;
    --out) OUT="$2"; shift 2 ;;
    -h|--help) sed -n '2,26p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "Unknown argument: $1" >&2; exit 2 ;;
  esac
done

REQ="requirements-light.txt"
[ "$PROFILE" = "full" ] && REQ="requirements.txt"

PYTHON="${PYTHON:-python3}"
PY_TAG="$("$PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
PLATFORM="$("$PYTHON" -c 'import platform; print(f"{platform.system().lower()}-{platform.machine()}")')"

echo "==> Building an offline bundle"
echo "    profile:  $PROFILE ($REQ)"
echo "    python:   $PY_TAG"
echo "    platform: $PLATFORM"
echo "    output:   $OUT"
echo

rm -rf "$OUT"
mkdir -p "$OUT/wheels" "$OUT/backend"

# ── 1. The frontend, already built ───────────────────────────────────
echo "==> Building the frontend"
( cd "$ROOT/frontend" && npm ci --silent && npm run build )
cp -a "$ROOT/frontend/dist" "$OUT/frontend-dist"

# ── 2. Every Python wheel, resolved and BUILT now ────────────────────
#
# `pip download` alone is not enough. Anything that publishes only a source
# distribution — python-louvain, at the time of writing — arrives as a
# .tar.gz that pip has to *build* on the target, and building needs
# setuptools and wheel fetched from an index that is not there. The install
# then dies partway through with "No matching distribution found for
# setuptools", which reads as a corrupt bundle rather than a missing step.
#
# `pip wheel` resolves and builds in one pass here, on the connected machine,
# so the bundle contains nothing but installable binaries.
echo "==> Building Python wheels"
PIP_ARGS=(--wheel-dir "$OUT/wheels" --requirement "$ROOT/backend/$REQ")
if [ "$PROFILE" = "full" ]; then
  # The CPU build. The default PyPI wheel drags in the CUDA runtime, which is
  # gigabytes of GPU driver for a machine that will never use one.
  PIP_ARGS+=(--extra-index-url https://download.pytorch.org/whl/cpu)
fi
"$PYTHON" -m pip wheel "${PIP_ARGS[@]}"

# The installer bootstraps a fresh venv with these before anything else; a
# venv created by an older Python does not necessarily ship a usable pair.
"$PYTHON" -m pip download --dest "$OUT/wheels" --only-binary=:all: pip setuptools wheel

REMAINING_SDISTS=$(find "$OUT/wheels" -name '*.tar.gz' -o -name '*.zip' | wc -l | tr -d ' ')
if [ "$REMAINING_SDISTS" != "0" ]; then
  echo "warning: $REMAINING_SDISTS source distribution(s) could not be built into wheels." >&2
  echo "         The target machine will need a compiler for them." >&2
  find "$OUT/wheels" \( -name '*.tar.gz' -o -name '*.zip' \) -printf '         %f\n' >&2
fi

# ── 3. The backend itself ────────────────────────────────────────────
echo "==> Copying the backend"
( cd "$ROOT/backend" && tar -cf - \
    --exclude='.venv*' --exclude='__pycache__' --exclude='*.pyc' \
    --exclude='data/uploads/*' --exclude='data/sample/*' \
    --exclude='data/*.duckdb' --exclude='data/logs/*' \
    app scripts requirements.txt requirements-light.txt pyproject.toml data \
) | ( cd "$OUT/backend" && tar -xf - )

# ── 4. What the target machine runs ──────────────────────────────────
cat > "$OUT/install.sh" <<'INSTALLER'
#!/usr/bin/env bash
# Install ChainTrace from this bundle. No network required.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PYTHON="${PYTHON:-python3}"

BUILT_PY="$(cat "$HERE/PYTHON_VERSION")"
HAVE_PY="$("$PYTHON" -c 'import sys; print(f"{sys.version_info.major}.{sys.version_info.minor}")')"
if [ "$BUILT_PY" != "$HAVE_PY" ]; then
  echo "This bundle's wheels were built for Python $BUILT_PY, but $PYTHON is $HAVE_PY." >&2
  echo "Wheels are version-specific. Rebuild the bundle on a machine running Python $HAVE_PY," >&2
  echo "or point PYTHON at a $BUILT_PY interpreter." >&2
  exit 1
fi

echo "==> Creating the virtual environment"
"$PYTHON" -m venv "$HERE/venv"

echo "==> Installing from the bundled wheels (no index)"
# --no-index is the point: pip must not be able to fall back to PyPI, so a
# missing wheel fails here, on the machine that can still fix it, rather than
# on the day the target is disconnected.
"$HERE/venv/bin/pip" install --quiet --upgrade --no-index \
  --find-links "$HERE/wheels" pip setuptools wheel
"$HERE/venv/bin/pip" install --no-index --find-links "$HERE/wheels" \
  -r "$HERE/backend/$(cat "$HERE/REQUIREMENTS")"

echo
echo "Installed. Start it with:  $HERE/run.sh"
INSTALLER

cat > "$OUT/run.sh" <<'RUNNER'
#!/usr/bin/env bash
# Start ChainTrace: one process, one port, no network.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PORT="${PORT:-8000}"

# The backend serves the built frontend from its own origin, so there is no
# second server, no CORS and no API URL to configure.
export CT_FRONTEND_DIST="${CT_FRONTEND_DIST:-$HERE/frontend-dist}"
export CT_LIGHT_MODE="${CT_LIGHT_MODE:-$(cat "$HERE/LIGHT_MODE")}"

echo "ChainTrace on http://127.0.0.1:$PORT  (light_mode=$CT_LIGHT_MODE)"
cd "$HERE/backend"
exec "$HERE/venv/bin/uvicorn" app.main:app --host "${HOST:-127.0.0.1}" --port "$PORT"
RUNNER

echo "$PY_TAG" > "$OUT/PYTHON_VERSION"
echo "$REQ" > "$OUT/REQUIREMENTS"
[ "$PROFILE" = "light" ] && echo "true" > "$OUT/LIGHT_MODE" || echo "false" > "$OUT/LIGHT_MODE"
chmod +x "$OUT/install.sh" "$OUT/run.sh"

cat > "$OUT/README.txt" <<EOF
ChainTrace Forensics — offline install bundle
=============================================

Built for : Python $PY_TAG on $PLATFORM
Profile   : $PROFILE ($REQ)

On the target machine, with no network:

    ./install.sh      # creates venv/ from the bundled wheels
    ./run.sh          # http://127.0.0.1:8000

That is the whole product on one port: the API and the interface, served by
one process. Nothing here reaches the internet.

The single exception is Ingest -> "Fetch Real Blockchain Data", which calls
Blockstream's public API by definition. On this machine it answers 502 with
an explanation. Use Upload, or generate a synthetic dataset instead.

Wheels are specific to Python $PY_TAG on $PLATFORM. On a different OS, CPU
architecture or Python minor version, rebuild the bundle there:

    scripts/bundle-offline.sh $( [ "$PROFILE" = full ] && echo --full )
EOF

WHEELS=$(find "$OUT/wheels" -name '*.whl' -o -name '*.tar.gz' | wc -l | tr -d ' ')
SIZE=$(du -sh "$OUT" | cut -f1)
echo
echo "==> Bundle ready: $OUT  ($SIZE, $WHEELS wheels)"
echo "    Copy it to the offline machine, then run ./install.sh && ./run.sh"
