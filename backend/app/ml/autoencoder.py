"""
ChainTrace Forensics — PyTorch Autoencoder
Unsupervised anomaly detection via reconstruction error.
Architecture: 13 → 32 → 16 → 8 → 16 → 32 → 13
"""

import torch
import torch.nn as nn
import numpy as np
from pathlib import Path
from sklearn.preprocessing import StandardScaler
from app.config import settings


class TransactionAutoencoder(nn.Module):
    """
    Symmetric autoencoder for wallet feature anomaly detection.

    Input: 13 behavioral features (normalized)
    Bottleneck: 8-dimensional latent space
    Output: 13 reconstructed features
    Anomaly Signal: MSE reconstruction error
    """

    def __init__(self, input_dim: int = 13, hidden_dims: list[int] = None):
        super().__init__()
        hidden_dims = hidden_dims or settings.AE_HIDDEN_DIMS  # [32, 16, 8]

        # Encoder
        encoder_layers = []
        prev_dim = input_dim
        for h_dim in hidden_dims:
            encoder_layers.extend([
                nn.Linear(prev_dim, h_dim),
                nn.LeakyReLU(0.2),
                nn.BatchNorm1d(h_dim),
                nn.Dropout(0.1),
            ])
            prev_dim = h_dim
        self.encoder = nn.Sequential(*encoder_layers)

        # Decoder (mirror of encoder)
        decoder_layers = []
        reversed_dims = list(reversed(hidden_dims[:-1])) + [input_dim]
        prev_dim = hidden_dims[-1]
        for i, h_dim in enumerate(reversed_dims):
            decoder_layers.append(nn.Linear(prev_dim, h_dim))
            if i < len(reversed_dims) - 1:
                decoder_layers.extend([
                    nn.LeakyReLU(0.2),
                    nn.BatchNorm1d(h_dim),
                    nn.Dropout(0.1),
                ])
            prev_dim = h_dim
        self.decoder = nn.Sequential(*decoder_layers)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        encoded = self.encoder(x)
        decoded = self.decoder(encoded)
        return decoded

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Get latent representation."""
        return self.encoder(x)

    def reconstruction_error(self, x: torch.Tensor) -> torch.Tensor:
        """Compute per-sample MSE reconstruction error."""
        with torch.no_grad():
            reconstructed = self.forward(x)
            error = torch.mean((x - reconstructed) ** 2, dim=1)
        return error


class AnomalyDetector:
    """
    Wraps the autoencoder with scaler, training, and scoring logic.
    """

    def __init__(self):
        self.model = TransactionAutoencoder(
            input_dim=settings.AE_INPUT_DIM,
            hidden_dims=settings.AE_HIDDEN_DIMS,
        )
        self.scaler = StandardScaler()
        self.threshold = 0.0
        self.is_trained = False
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model.to(self.device)

    def train(
        self,
        features: np.ndarray,
        epochs: int = None,
        batch_size: int = None,
        learning_rate: float = None,
    ) -> dict:
        """
        Train the autoencoder on wallet features.

        Args:
            features: (N, 13) numpy array of wallet features
            epochs: Training epochs (default from settings)
            batch_size: Batch size (default from settings)
            learning_rate: Learning rate (default from settings)

        Returns: Training history dict
        """
        epochs = epochs or settings.AE_EPOCHS
        batch_size = batch_size or settings.AE_BATCH_SIZE
        learning_rate = learning_rate or settings.AE_LEARNING_RATE

        # Normalize features
        X_scaled = self.scaler.fit_transform(features)
        X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(self.device)

        # Create DataLoader
        dataset = torch.utils.data.TensorDataset(X_tensor)
        loader = torch.utils.data.DataLoader(
            dataset, batch_size=batch_size, shuffle=True
        )

        # Optimizer and loss
        optimizer = torch.optim.Adam(self.model.parameters(), lr=learning_rate)
        criterion = nn.MSELoss()

        # Training loop
        self.model.train()
        history = {"loss": []}

        for epoch in range(epochs):
            epoch_loss = 0.0
            for (batch,) in loader:
                optimizer.zero_grad()
                output = self.model(batch)
                loss = criterion(output, batch)
                loss.backward()
                optimizer.step()
                epoch_loss += loss.item()

            avg_loss = epoch_loss / len(loader)
            history["loss"].append(avg_loss)

            if (epoch + 1) % 20 == 0:
                print(f"  Epoch {epoch + 1}/{epochs} — Loss: {avg_loss:.6f}")

        # Compute anomaly threshold (percentile of reconstruction errors)
        self.model.eval()
        errors = self.model.reconstruction_error(X_tensor).cpu().numpy()
        self.threshold = float(np.percentile(errors, settings.ANOMALY_PERCENTILE))
        self.is_trained = True

        history["threshold"] = self.threshold
        history["mean_error"] = float(np.mean(errors))
        history["max_error"] = float(np.max(errors))

        print(f"  ✓ Training complete. Threshold: {self.threshold:.6f}")

        return history

    def score(self, features: np.ndarray) -> np.ndarray:
        """
        Compute anomaly scores for wallet features.

        Returns: (N,) array of reconstruction errors (higher = more anomalous)
        """
        if not self.is_trained:
            raise RuntimeError("Model must be trained before scoring")

        X_scaled = self.scaler.transform(features)
        X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(self.device)

        self.model.eval()
        errors = self.model.reconstruction_error(X_tensor).cpu().numpy()
        return errors

    def predict(self, features: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
        """
        Predict anomalies.

        Returns: (anomaly_flags, anomaly_scores)
            anomaly_flags: (N,) bool array
            anomaly_scores: (N,) float array (0-100 confidence)
        """
        errors = self.score(features)

        # Normalize errors to 0-100 scale
        max_err = max(self.threshold * 3, np.max(errors))
        scores = np.clip(errors / max_err * 100, 0, 100)

        flags = errors > self.threshold
        return flags, scores

    def save(self, path: Path = None) -> None:
        """Save model, scaler, and threshold to disk."""
        path = path or settings.MODELS_DIR
        path.mkdir(parents=True, exist_ok=True)

        torch.save({
            "model_state": self.model.state_dict(),
            "scaler_mean": self.scaler.mean_,
            "scaler_scale": self.scaler.scale_,
            "threshold": self.threshold,
        }, path / "autoencoder.pt")
        print(f"  ✓ Model saved to {path / 'autoencoder.pt'}")

    def load(self, path: Path = None) -> bool:
        """Load model from disk. Returns True if successful."""
        path = path or settings.MODELS_DIR
        model_file = path / "autoencoder.pt"

        if not model_file.exists():
            return False

        checkpoint = torch.load(model_file, map_location=self.device, weights_only=False)
        self.model.load_state_dict(checkpoint["model_state"])
        self.scaler.mean_ = checkpoint["scaler_mean"]
        self.scaler.scale_ = checkpoint["scaler_scale"]
        self.scaler.n_features_in_ = len(checkpoint["scaler_mean"])
        self.threshold = checkpoint["threshold"]
        self.is_trained = True

        self.model.eval()
        print(f"  ✓ Model loaded from {model_file}")
        return True

    def predict_function(self, data: np.ndarray) -> np.ndarray:
        """
        Prediction function for SHAP explainer.
        Returns per-feature reconstruction error (not summed).
        """
        X_scaled = self.scaler.transform(data)
        X_tensor = torch.tensor(X_scaled, dtype=torch.float32).to(self.device)
        self.model.eval()
        with torch.no_grad():
            reconstructed = self.model(X_tensor)
            # Per-feature error
            error = (X_tensor - reconstructed) ** 2
        return error.cpu().numpy()
