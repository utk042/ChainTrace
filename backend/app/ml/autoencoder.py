"""
ChainTrace Forensics — Anomaly detection backend selection

`AnomalyDetector()` returns whichever reconstruction-error model this
deployment can actually afford to run:

  • app/ml/torch_backend.py — the PyTorch autoencoder (non-linear, the
    stronger detector) when torch is installed and light mode is off.
  • app/ml/light.py — a PCA linear autoencoder with the same interface,
    when torch is missing or CT_LIGHT_MODE is set.

Both expose train / score / predict / predict_function / save / load, so
nothing downstream — the trainer, the SHAP explainer, the alert generator —
needs to know which one it got.

torch is imported here only if it is going to be used. That matters: the
import alone reserves a few hundred megabytes, and on a small container the
process is OOM-killed at import time, long before any request arrives.
"""

from app.config import settings

_backend_cls = None
_backend_reason = ""


def _torch_importable() -> bool:
    import importlib.util
    return importlib.util.find_spec("torch") is not None


def _select_backend():
    """Resolve (and memoise) the detector class for this process."""
    global _backend_cls, _backend_reason
    if _backend_cls is not None:
        return _backend_cls

    if settings.LIGHT_MODE:
        from app.ml.light import PCAAnomalyDetector
        _backend_cls = PCAAnomalyDetector
        _backend_reason = "CT_LIGHT_MODE is enabled"
    elif not _torch_importable():
        from app.ml.light import PCAAnomalyDetector
        _backend_cls = PCAAnomalyDetector
        _backend_reason = "PyTorch is not installed"
    else:
        from app.ml.torch_backend import TorchAnomalyDetector
        _backend_cls = TorchAnomalyDetector
        _backend_reason = "PyTorch is available"

    return _backend_cls


def backend_name() -> str:
    """Identifier of the active backend, e.g. for /api/health."""
    return _select_backend().backend_name


def backend_reason() -> str:
    _select_backend()
    return _backend_reason


def is_light_mode() -> bool:
    from app.ml.light import PCAAnomalyDetector
    return _select_backend() is PCAAnomalyDetector


def AnomalyDetector():
    """Construct the anomaly detector for this deployment."""
    return _select_backend()()
