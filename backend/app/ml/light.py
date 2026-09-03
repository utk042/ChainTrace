"""
ChainTrace Forensics — Low-memory analysis backend

A drop-in replacement for the PyTorch autoencoder that runs the same
reconstruction-error anomaly detection using only NumPy and scikit-learn.

Why this exists: `import torch` alone costs ~250 MB of resident memory, and
torch-geometric's Node2Vec training allocates far more on top of that. On a
512 MB container — Render's free tier, a small VM, a locked-down analyst
laptop — the process is killed before it scores a single wallet, which looks
from the outside exactly like "the deployment doesn't load any data".

The method here is a linear autoencoder: PCA to a low-dimensional bottleneck,
then reconstruct and measure per-feature squared error. That is precisely what
the neural autoencoder does, minus the non-linearity — same interface, same
score semantics (higher error = more anomalous), same percentile threshold,
same per-feature error vector for the explainer to attribute over. It is
weaker at curved decision boundaries and stronger at nothing, so it is a
fallback rather than a default: with torch present and memory to spare, the
neural model still runs.
"""

import numpy as np
from pathlib import Path
from sklearn.decomposition import PCA
from sklearn.preprocessing import StandardScaler

from app.config import settings

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
        # Matches the neural model's bottleneck width so the two backends
        # compress to the same number of latent dimensions.
        self.latent_dim = settings.AE_HIDDEN_DIMS[-1]

    # ── Training ──────────────────────────────────────────────────────
    def train(self, features: np.ndarray, **_ignored) -> dict:
        """
        Fit the projection on the wallet feature matrix.

        Extra keyword arguments (epochs, batch_size, learning_rate) are
        accepted and ignored so the trainer can call either backend the same
        way — a closed-form fit has no epochs to run.
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
        print(f"  ✓ Linear autoencoder fitted: {n_components} components, "
              f"{explained:.1%} variance retained. Threshold: {self.threshold:.6f}")

        return {
            # One "epoch": the fit is closed-form, but the trainer logs
            # history["loss"][-1], so report the achieved reconstruction MSE.
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
    def save(self, path: Path = None) -> None:
        path = path or settings.MODELS_DIR
        path.mkdir(parents=True, exist_ok=True)
        np.savez(
            path / "linear_autoencoder.npz",
            components=self.pca.components_,
            mean=self.pca.mean_,
            scaler_mean=self.scaler.mean_,
            scaler_scale=self.scaler.scale_,
            threshold=np.array([self.threshold]),
        )
        print(f"  ✓ Model saved to {path / 'linear_autoencoder.npz'}")

    def load(self, path: Path = None) -> bool:
        path = path or settings.MODELS_DIR
        model_file = path / "linear_autoencoder.npz"
        if not model_file.exists():
            return False

        try:
            data = np.load(model_file)
            components = data["components"]
        except Exception as e:
            print(f"  ⚠ Could not read {model_file} ({e}). Will refit.")
            return False

        # Same self-healing check the neural backend does: a checkpoint from a
        # different feature schema has the wrong width and is worse than
        # useless, because it would silently score against the wrong columns.
        if components.shape[1] != settings.AE_INPUT_DIM:
            print(f"  ⚠ Saved model expects {components.shape[1]} features, current schema "
                  f"has {settings.AE_INPUT_DIM}. Discarding stale checkpoint, will refit.")
            return False

        self.pca = PCA(n_components=components.shape[0])
        self.pca.components_ = components
        self.pca.mean_ = data["mean"]
        self.pca.n_components_ = components.shape[0]
        self.pca.n_features_in_ = components.shape[1]
        self.scaler.mean_ = data["scaler_mean"]
        self.scaler.scale_ = data["scaler_scale"]
        self.scaler.n_features_in_ = len(data["scaler_mean"])
        self.threshold = float(data["threshold"][0])
        self.is_trained = True

        print(f"  ✓ Model loaded from {model_file}")
        return True
