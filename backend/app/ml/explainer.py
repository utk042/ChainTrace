"""
ChainTrace Forensics — SHAP Explainer
Generates per-feature attribution for anomaly flags using SHAP KernelExplainer.
"""

import numpy as np
from typing import Optional
from app.ml.features import FEATURE_NAMES
from app.config import settings

try:
    import shap
    SHAP_AVAILABLE = True
except ImportError:
    SHAP_AVAILABLE = False
    print("⚠ SHAP not available. Using fallback explainability.")


class AnomalyExplainer:
    """
    Explains why a wallet was flagged as anomalous using SHAP values.
    Wraps shap.KernelExplainer around the autoencoder's reconstruction error.
    """

    def __init__(self, detector=None):
        self.detector = detector
        self.explainer = None
        self.background_data = None

    def initialize(self, background_features: np.ndarray) -> None:
        """
        Initialize the SHAP explainer with background data.

        Args:
            background_features: Representative sample of normal features (N, 13)
        """
        if not SHAP_AVAILABLE or self.detector is None:
            return

        # Sample background data
        n_samples = min(settings.SHAP_BACKGROUND_SIZE, len(background_features))
        indices = np.random.choice(len(background_features), n_samples, replace=False)
        self.background_data = background_features[indices]

        # Wrap detector's scoring function for SHAP
        def predict_fn(data: np.ndarray) -> np.ndarray:
            """Returns total reconstruction error for each sample."""
            errors = self.detector.score(data)
            return errors.reshape(-1, 1)

        self.explainer = shap.KernelExplainer(predict_fn, self.background_data)
        print(f"  ✓ SHAP explainer initialized with {n_samples} background samples")

    def explain(self, features: np.ndarray, n_samples: int = 50) -> list[dict]:
        """
        Explain anomaly scores for a set of feature vectors.

        Args:
            features: (N, 13) feature matrix for flagged wallets
            n_samples: SHAP kernel samples (lower = faster, less accurate)

        Returns: List of {feature: str, value: float, contribution: float} per sample
        """
        if not SHAP_AVAILABLE or self.explainer is None:
            return self._fallback_explain(features)

        try:
            shap_values = self.explainer.shap_values(features, nsamples=n_samples)
            if isinstance(shap_values, list):
                shap_values = shap_values[0]
            shap_values = np.asarray(shap_values)
            if shap_values.ndim == 3:
                shap_values = shap_values.squeeze(-1)

            results = []
            for i in range(len(features)):
                sample_explanation = []
                sv = shap_values[i] if shap_values.ndim > 1 else shap_values

                for j, fname in enumerate(FEATURE_NAMES):
                    raw_val = sv[j] if j < len(sv) else 0.0
                    val = float(np.squeeze(raw_val))
                    sample_explanation.append({
                        "feature": fname,
                        "value": round(float(features[i, j]), 6),
                        "contribution": round(val, 6),
                    })

                # Sort by absolute contribution
                sample_explanation.sort(key=lambda x: -abs(x["contribution"]))
                results.append(sample_explanation)

            return results

        except Exception as e:
            print(f"  ⚠ SHAP explanation failed: {e}. Using fallback.")
            return self._fallback_explain(features)

    def explain_single(self, features: np.ndarray) -> list[dict]:
        """Explain a single wallet's anomaly score."""
        if features.ndim == 1:
            features = features.reshape(1, -1)
        results = self.explain(features, n_samples=30)
        return results[0] if results else []

    def _fallback_explain(self, features: np.ndarray) -> list[dict]:
        """
        Fallback explainability: use reconstruction error per feature.
        Compare each feature to the training data mean/std.
        """
        results = []

        for i in range(len(features)):
            sample_explanation = []

            if self.detector and self.detector.is_trained:
                # Use per-feature reconstruction error
                per_feature_errors = self.detector.predict_function(features[i:i+1])
                errors = per_feature_errors[0]

                for j, fname in enumerate(FEATURE_NAMES):
                    sample_explanation.append({
                        "feature": fname,
                        "value": round(float(features[i, j]), 6),
                        "contribution": round(float(errors[j]), 6),
                    })
            else:
                # No model: just report raw feature values
                for j, fname in enumerate(FEATURE_NAMES):
                    sample_explanation.append({
                        "feature": fname,
                        "value": round(float(features[i, j]), 6),
                        "contribution": 0.0,
                    })

            sample_explanation.sort(key=lambda x: -abs(x["contribution"]))
            results.append(sample_explanation)

        return results

    def generate_description(self, shap_explanation: list[dict], score: float, eff: Optional[dict] = None) -> str:
        """Generate a human-readable description from SHAP values.

        `eff`: effective (Settings-page-aware) thresholds from
        app.runtime_settings.get_effective_settings() — falls back to the
        static config defaults when not supplied.
        """
        if not shap_explanation:
            return "Anomalous activity detected."

        round_amount_threshold = eff["round_amount_threshold"] if eff else settings.ROUND_AMOUNT_THRESHOLD
        velocity_spike_threshold = eff["velocity_spike_threshold"] if eff else settings.VELOCITY_SPIKE_THRESHOLD

        # Top 3 contributing features
        top_features = shap_explanation[:3]
        parts = []

        for feat in top_features:
            fname = feat["feature"]
            value = feat["value"]
            contribution = feat["contribution"]

            if contribution <= 0:
                continue

            if fname == "fan_in_degree" and value > 10:
                parts.append(f"High fan-in of {int(value)} addresses")
            elif fname == "fan_out_degree" and value > 10:
                parts.append(f"High fan-out to {int(value)} addresses")
            elif fname == "velocity_1h" and value > velocity_spike_threshold:
                parts.append(f"Velocity spike: {int(value)} tx/hr")
            elif fname == "round_amount_ratio" and value > round_amount_threshold:
                parts.append(f"Round-amount ratio: {value:.0%}")
            elif fname == "amount_variance" and value > 1.0:
                parts.append(f"High amount variance: {value:.2f}")
            elif fname == "unique_countries" and value > 5:
                parts.append(f"Multi-jurisdiction: {int(value)} countries")
            elif fname == "age_days" and value < 1:
                parts.append(f"New wallet (age: {value:.1f} days)")
            elif fname == "tx_count" and value > 50:
                parts.append(f"High transaction volume: {int(value)} tx")
            elif fname == "peel_chain_depth" and value >= 1:
                parts.append(f"Peel-shaped output structure (depth {int(value)})")
            elif fname == "mixer_interaction_count" and value >= 1:
                parts.append(f"Touches {int(value)} CoinJoin-like transaction(s)")
            elif fname == "darknet_proximity_score" and value > 0:
                parts.append(f"Graph-proximate to a watchlisted wallet (proximity {value:.2f})")
            else:
                parts.append(f"Unusual {fname.replace('_', ' ')}: {value:.4g}")

        if not parts:
            return "Anomalous reconstruction pattern detected by autoencoder model."

        return ". ".join(parts) + "."
