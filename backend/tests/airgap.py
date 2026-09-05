"""
Air-gap acceptance test: the backend must work with no network at all.

ChainTrace is meant to run on a disconnected machine, and "meant to" is not
a property anything checks. A dependency that phones home on import, a
model that downloads weights on first use, a geo lookup that falls back to
a web service — each would work perfectly on a developer's laptop and fail
on the machine the tool exists for. So this test does not *simulate* being
offline: it makes every non-loopback socket raise, then drives the whole
product through it.

What it covers, in one sequence because the later steps need the earlier
ones' data:

  1. import and start the app
  2. generate a synthetic dataset
  3. run the full pipeline (parse, validate, enrich, load, analyse)
  4. read every endpoint the frontend calls, including entity-level ones
  5. serve the built frontend, if one is present
  6. check that the one network-dependent feature fails honestly

Any outbound connection attempt is recorded and fails the run, naming the
host — including one made by a library at import time.

Run:  python tests/airgap.py            (from backend/, with deps installed)
      CT_LIGHT_MODE=true python tests/airgap.py
"""

import os
import socket
import sys
import time
from pathlib import Path

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

# ─── The air gap ─────────────────────────────────────────────────────
#
# Installed before the app is imported, so anything that dials out while
# its module body runs is caught too.

VIOLATIONS = []
_LOOPBACK = {"127.0.0.1", "::1", "localhost", "0.0.0.0", ""}

_real_connect = socket.socket.connect
_real_connect_ex = socket.socket.connect_ex
_real_getaddrinfo = socket.getaddrinfo


def _is_local(address) -> bool:
    host = address[0] if isinstance(address, tuple) else address
    return str(host) in _LOOPBACK or str(host).startswith("127.")


def _blocked_connect(self, address):
    if not _is_local(address):
        VIOLATIONS.append(f"connect -> {address}")
        raise OSError(101, "Network is unreachable (air-gap test)")
    return _real_connect(self, address)


def _blocked_connect_ex(self, address):
    if not _is_local(address):
        VIOLATIONS.append(f"connect_ex -> {address}")
        return 101
    return _real_connect_ex(self, address)


def _blocked_getaddrinfo(host, *args, **kwargs):
    if not _is_local(host):
        VIOLATIONS.append(f"dns -> {host}")
        raise socket.gaierror(-2, "Name resolution disabled (air-gap test)")
    return _real_getaddrinfo(host, *args, **kwargs)


socket.socket.connect = _blocked_connect
socket.socket.connect_ex = _blocked_connect_ex
socket.getaddrinfo = _blocked_getaddrinfo

# The one endpoint that is *supposed* to reach the internet. Its attempt is
# expected, so it is not counted against the run.
EXPECTED_HOSTS = ("blockstream.info",)


def unexpected_violations():
    return [v for v in VIOLATIONS if not any(h in v for h in EXPECTED_HOSTS)]


# ─── Harness ─────────────────────────────────────────────────────────

FAILURES = []


def check(ok, label, detail=""):
    print(f"{'PASS' if ok else 'FAIL'}  {label}{f'  ({detail})' if detail else ''}", flush=True)
    if not ok:
        FAILURES.append(label)


def main():
    # A throwaway data directory. The run generates a dataset and ingests it,
    # and doing that in backend/data/ would overwrite the repository's own
    # sample files and whatever case the developer had loaded. These are read
    # when app.config is imported, so they are set before that happens.
    import tempfile
    workdir = Path(tempfile.mkdtemp(prefix="chaintrace-airgap-"))
    os.environ.setdefault("CT_DATA_DIR", str(workdir))
    os.environ.setdefault("CT_DUCKDB_PATH", str(workdir / "airgap.duckdb"))
    os.environ.setdefault("CT_MODELS_DIR", str(workdir / "models"))
    for sub in ("sample", "uploads", "models", "logs"):
        (workdir / sub).mkdir(parents=True, exist_ok=True)
    print(f"      (working in {workdir})")

    # The test client logs a line per request at INFO, which buries the
    # report under a transcript of itself.
    import logging
    logging.getLogger("httpx").setLevel(logging.WARNING)

    from fastapi.testclient import TestClient
    from app.main import app

    check(not unexpected_violations(), "importing the app reaches no network",
          "; ".join(unexpected_violations()))

    with TestClient(app) as client:
        # 1. Liveness
        health = client.get("/api/health")
        check(health.status_code == 200 and health.json().get("status") in ("healthy", "degraded"),
              "GET /api/health", f"{health.status_code}")

        # 2. Build a dataset from nothing
        gen = client.post("/api/ingest/generate-sample?count=800")
        check(gen.status_code == 200 and gen.json().get("count", 0) > 0,
              "synthetic dataset generated offline", f"{gen.json().get('count')} records")

        # 3. The whole pipeline: parse, validate, enrich (GeoIP), load, analyse
        run = client.post("/api/ingest/run")
        check(run.status_code == 200, "pipeline accepted", f"{run.status_code}")

        deadline = time.time() + 600
        status = {}
        while time.time() < deadline:
            status = client.get("/api/ingest/status").json()
            if status.get("status") in ("completed", "failed"):
                break
            time.sleep(2)
        check(status.get("status") == "completed", "pipeline completed offline",
              f"{status.get('status')}: {status.get('message')}")

        # 4. Every read the frontend makes
        reads = [
            "/api/health",
            "/api/dashboard/stats",
            "/api/dashboard/timeline?interval=day",
            "/api/dashboard/risk-distribution",
            "/api/dashboard/top-alerts?limit=5",
            "/api/alerts?page=1&page_size=25&sort_by=confidence&sort_order=desc",
            "/api/alerts/export",
            "/api/wallets?page=1&page_size=25&sort_by=anomaly_score&sort_order=desc",
            "/api/transactions?page=1&page_size=25&sort_by=timestamp&sort_order=desc",
            "/api/graph/data?layout=spring&max_nodes=1500",
            "/api/graph/stats",
            "/api/graph/clusters",
            "/api/graph/search?q=1&limit=5",
            "/api/settings",
            "/api/settings/seed-wallets",
            "/api/ingest/status",
            "/api/ingest/logs?limit=5",
            "/api/logs?limit=5",
        ]
        bad = [p for p in reads if client.get(p).status_code != 200]
        check(not bad, "every frontend read answers 200 offline", "; ".join(bad))

        # 5. Entity-level reads, which go through the graph and the tables
        wallets = client.get("/api/wallets?page=1&page_size=1").json().get("wallets", [])
        check(bool(wallets), "the pipeline produced wallet rows")
        if wallets:
            address = wallets[0]["address"]
            entity = [
                f"/api/wallets/{address}",
                f"/api/graph/node/{address}",
                f"/api/graph/neighbors/{address}?limit=10",
                f"/api/graph/subgraph/{address}?hops=2",
            ]
            bad = [p for p in entity if client.get(p).status_code != 200]
            check(not bad, "entity-level reads answer 200 offline", "; ".join(bad))

        # 6. A write, so the offline claim covers more than reads
        wrote = client.put("/api/settings", json={"anomaly_percentile": "97.0"})
        check(wrote.status_code == 200, "settings write succeeds offline", f"{wrote.status_code}")

        # 7. The frontend, when a build is present. Skipped rather than
        #    failed when there is none: `npm run build` is a separate step.
        from app.config import settings as app_settings
        if (Path(app_settings.FRONTEND_DIST) / "index.html").is_file():
            shell = client.get("/")
            check(shell.status_code == 200 and "text/html" in shell.headers.get("content-type", ""),
                  "the backend serves the frontend shell", f"{shell.status_code}")
            route = client.get("/wallets")
            check(route.status_code == 200 and "text/html" in route.headers.get("content-type", ""),
                  "a client-side route falls back to the shell", f"{route.status_code}")
            # The failure this ordering exists to prevent: an unmatched API
            # path answered with the HTML shell and a 200.
            missing = client.get("/api/definitely-not-a-route")
            check(missing.status_code == 404 and "html" not in missing.headers.get("content-type", ""),
                  "an unknown /api path is JSON 404, never the shell",
                  f"{missing.status_code} {missing.headers.get('content-type')}")
            worker = client.get("/sw.js")
            if worker.status_code == 200:
                check("no-cache" in worker.headers.get("cache-control", ""),
                      "the service worker is served no-cache",
                      worker.headers.get("cache-control"))
        else:
            print("SKIP  frontend serving (no build at "
                  f"{app_settings.FRONTEND_DIST}; run `npm run build` in frontend/)")

        # 8. The one feature that needs the internet must fail, and say so.
        fetched = client.post("/api/ingest/fetch-real?max_transactions=1&max_blocks=1")
        body = fetched.json()
        check(fetched.status_code == 502 and "error" in body,
              "fetch-real fails with 502 and an explanation offline",
              f"{fetched.status_code}: {str(body.get('error'))[:70]}")

    # The API-only shape, which is what a cloud deployment runs. Whether the
    # frontend routes exist is decided once, at import, so this needs its own
    # process. It is here because it is easy to break from the other side:
    # moving the API's own description under /api left `/` returning 404 on
    # every deployment that serves no frontend.
    import subprocess
    probe = subprocess.run(
        [sys.executable, "-c", (
            "import logging; logging.disable(logging.INFO)\n"
            "from fastapi.testclient import TestClient\n"
            "from app.main import app\n"
            "c = TestClient(app)\n"
            "r = c.get('/')\n"
            "print(r.status_code, r.headers.get('content-type'), r.json().get('name'))\n"
        )],
        cwd=str(BACKEND),
        env={**os.environ, "CT_FRONTEND_DIST": str(Path(workdir) / "no-frontend-here")},
        capture_output=True, text=True,
    )
    out = probe.stdout.strip().splitlines()[-1] if probe.stdout.strip() else probe.stderr[-200:]
    check(probe.returncode == 0 and out.startswith("200 application/json")
          and "ChainTrace" in out,
          "with no frontend build, / still answers with the API description", out)

    # Nothing above should have reached out except the fetch-real attempt.
    check(not unexpected_violations(), "no unexpected outbound connection in the whole run",
          "; ".join(unexpected_violations()))

    print()
    if FAILURES:
        print(f"{len(FAILURES)} FAILURES:\n  - " + "\n  - ".join(FAILURES))
        return 1
    print("The backend runs fully offline.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
