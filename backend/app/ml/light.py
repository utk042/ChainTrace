"""
ChainTrace Forensics — Low-memory analysis backend

A drop-in replacement for the PyTorch autoencoder using only NumPy and
scikit-learn, for hosts that cannot afford torch: the import alone costs
~250 MB resident, and Node2Vec training far more, which on a 512 MB
container gets the process OOM-killed mid-pipeline.

The method is a linear autoencoder — PCA to a low-dimensional bottleneck,
then reconstruct and measure per-feature squared error. Same interface and
same score semantics as the neural model (higher error = more anomalous,
percentile threshold, per-feature error vector for the explainer), without
the non-linearity. Strictly weaker, so it is a fallback rather than a
default.
"""

import numpy as np
from pathlib import Path
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from app.config import settings

from app.logging_config import get_logger

logger = get_logger("app.ml.light")

BACKEND_NAME = "pca-linear-autoencoder"


class PCAAnomalyDetector:
    """
    Linear-autoencoder anomaly detector.

    Mirrors the interface of TorchAnomalyDetector: train / score / predict /
    predict_function / save / load, plus the `is_trained` and `threshold`
    attributes the trainer and explainer read.
    """

    backend_name = BACKEND_NAME

    def __init__(self):
        self.scaler = StandardScaler()
        self.pca: PCA | None = None
        self.threshold = 0.0
        self.is_trained = False
        # Same bottleneck width as the neural model.
        self.latent_dim = settings.AE_HIDDEN_DIMS[-1]

    # ── Training ──────────────────────────────────────────────────────
    def train(self, features: np.ndarray, **_ignored) -> dict:
        """
        Fit the projection on the wallet feature matrix.

        Extra keyword arguments (epochs, batch_size, learning_rate) are
        accepted and ignored: the fit is closed-form, and the trainer calls
        both backends the same way.
        """
        X_scaled = self.scaler.fit_transform(features)

        n_components = int(min(self.latent_dim, X_scaled.shape[0], X_scaled.shape[1]))
        n_components = max(1, n_components)
        self.pca = PCA(n_components=n_components, random_state=42)
        self.pca.fit(X_scaled)

        errors = self._errors(X_scaled)
        self.threshold = float(np.percentile(errors, settings.ANOMALY_PERCENTILE))
        self.is_trained = True

        explained = float(self.pca.explained_variance_ratio_.sum())
        logger.info(f"Linear autoencoder fitted: {n_components} components, "
              f"{explained:.1%} variance retained. Threshold: {self.threshold:.6f}")

        return {
            # The trainer logs history["loss"][-1]; report the achieved
            # reconstruction MSE as a single entry.
            "loss": [float(np.mean(errors))],
            "threshold": self.threshold,
            "mean_error": float(np.mean(errors)),
            "max_error": float(np.max(errors)),
            "explained_variance": explained,
            "backend": BACKEND_NAME,
        }

    # ── Scoring ───────────────────────────────────────────────────────
    def _errors(self, X_scaled: np.ndarray) -> np.ndarray:
        reconstructed = self.pca.inverse_transform(self.pca.transform(X_scaled))
        return np.mean((X_scaled - reconstructed) ** 2, axis=1)

    def score(self, features: np.ndarray) -> np.ndarray:
        if not self.is_trained:
            raise RuntimeError("Model must be trained before scoring")
        return self._errors(self.scaler.transform(features))

    def predict(self, features: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        errors = self.score(features)
        max_err = max(self.threshold * 3, float(np.max(errors)) if len(errors) else 1.0)
        max_err = max_err or 1.0
        scores = np.clip(errors / max_err * 100, 0, 100)
        return errors > self.threshold, scores

    def predict_function(self, data: np.ndarray) -> np.ndarray:
        """Per-feature squared reconstruction error, for the explainer."""
        X_scaled = self.scaler.transform(data)
        reconstructed = self.pca.inverse_transform(self.pca.transform(X_scaled))
        return (X_scaled - reconstructed) ** 2

    # ── Persistence ───────────────────────────────────────────────────
    # Everything sklearn's PCA.transform touches. `explained_variance_` is
    # not optional decoration: PCA.transform reads it on every call, so a
    # checkpoint saved without it reloads into an object that raises
    # `AttributeError: 'PCA' object has no attribute 'explained_variance_'`
    # the moment it is used. That made every pipeline run after the first
    # one fail — the first run fits and scores in memory, the second finds
    # the checkpoint on disk, loads it instead of fitting, and dies at the
    # scoring step with the model half-built.
    _CHECKPOINT_KEYS = (
        "components", "mean", "explained_variance", "explained_variance_ratio",
        "singular_values", "scaler_mean", "scaler_scale", "threshold",
    )

    def save(self, path: Path = None) -> None:
        path = path or settings.MODELS_DIR
        path.mkdir(parents=True, exist_ok=True)
        np.savez(
            path / "linear_autoencoder.npz",
            components=self.pca.components_,
            mean=self.pca.mean_,
            explained_variance=self.pca.explained_variance_,
            explained_variance_ratio=self.pca.explained_variance_ratio_,
            singular_values=self.pca.singular_values_,
            n_samples=np.array([getattr(self.pca, "n_samples_", 0)]),
            scaler_mean=self.scaler.mean_,
            scaler_scale=self.scaler.scale_,
            threshold=np.array([self.threshold]),
        )
        logger.info("Model saved to %s", path / "linear_autoencoder.npz")

    def load(self, path: Path = None) -> bool:
        path = path or settings.MODELS_DIR
        model_file = path / "linear_autoencoder.npz"
        if not model_file.exists():
            return False

        try:
            data = np.load(model_file)
            components = data["components"]
        except Exception as e:
            logger.warning("Could not read %s (%s). Will refit.", model_file, e)
            return False

        # A checkpoint written before the fields above were persisted cannot
        # be rebuilt into a working PCA. Refitting costs one closed-form fit;
        # loading it anyway costs the whole run.
        missing = [k for k in self._CHECKPOINT_KEYS if k not in data.files]
        if missing:
            logger.warning(
                "Checkpoint %s predates the current format (missing %s). Will refit.",
                model_file, ", ".join(missing),
            )
            return False

        # A checkpoint from a different feature schema has the wrong width
        # and would score against the wrong columns.
        if components.shape[1] != settings.AE_INPUT_DIM:
            logger.warning(
                "Saved model expects %s features, current schema has %s. "
                "Discarding stale checkpoint, will refit.",
                components.shape[1], settings.AE_INPUT_DIM,
            )
            return False

        pca = PCA(n_components=components.shape[0])
        pca.components_ = components
        pca.mean_ = data["mean"]
        pca.explained_variance_ = data["explained_variance"]
        pca.explained_variance_ratio_ = data["explained_variance_ratio"]
        pca.singular_values_ = data["singular_values"]
        pca.n_components_ = components.shape[0]
        pca.n_features_in_ = components.shape[1]
        pca.n_samples_ = int(data["n_samples"][0]) if "n_samples" in data.files else 0
        pca.noise_variance_ = 0.0
        pca.whiten = False

        scaler = StandardScaler()
        scaler.mean_ = data["scaler_mean"]
        scaler.scale_ = data["scaler_scale"]
        scaler.var_ = scaler.scale_ ** 2
        scaler.n_features_in_ = len(data["scaler_mean"])
        scaler.n_samples_seen_ = 1

        # Prove the restored model actually scores before adopting it.
        # Reconstructing an sklearn estimator by assigning attributes is
        # inherently version-sensitive, and the failure mode without this
        # check is not a warning but a dead pipeline run.
        try:
            probe = np.zeros((1, settings.AE_INPUT_DIM), dtype=float)
            pca.inverse_transform(pca.transform(scaler.transform(probe)))
        except Exception as e:
            logger.warning(
                "Restored checkpoint %s is not usable (%s). Will refit.", model_file, e,
            )
            return False

        self.pca = pca
        self.scaler = scaler
        self.threshold = float(data["threshold"][0])
        self.is_trained = True

        logger.info("Model loaded from %s", model_file)
        return True
