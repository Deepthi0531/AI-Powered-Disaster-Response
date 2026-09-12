"""
Comprehensive ML Model Comparison for Flood Risk Classification
with Conformal Prediction Uncertainty Quantification.

Models tested: XGBoost, LightGBM, RandomForest, ExtraTrees, MLP, TabNet-like MLP
Conformal prediction for calibrated uncertainty sets.
"""

import os
import sys
import json
import time
import numpy as np
import pandas as pd
import torch
import torch.nn as nn
import torch.optim as optim
from torch.utils.data import DataLoader, TensorDataset
from sklearn.model_selection import train_test_split, cross_val_score
from sklearn.preprocessing import StandardScaler, LabelEncoder
from sklearn.compose import ColumnTransformer
from sklearn.pipeline import Pipeline
from sklearn.metrics import (
    accuracy_score, f1_score, classification_report,
    confusion_matrix, roc_auc_score, log_loss
)
from sklearn.ensemble import RandomForestClassifier, ExtraTreesClassifier, GradientBoostingClassifier
from sklearn.calibration import CalibratedClassifierCV
import xgboost as xgb
import warnings
warnings.filterwarnings('ignore')

try:
    import lightgbm as lgb
    HAS_LGB = True
except ImportError:
    HAS_LGB = False

try:
    import shap
    HAS_SHAP = True
except ImportError:
    HAS_SHAP = False

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
OUTPUT_DIR = os.path.join(BASE_DIR, "results")
os.makedirs(OUTPUT_DIR, exist_ok=True)

# ====================
# Dataset Generation
# ====================
def generate_dataset(n_samples=2000, seed=42):
    np.random.seed(seed)
    land_uses = ["Urban", "Residential", "Agricultural", "Forest"]
    soil_groups = ["Group A", "Group B", "Group C", "Group D"]
    drain_types = ["Open Ditch", "Concrete Pipe", "Curb Inlet"]

    data = []
    for _ in range(n_samples):
        elevation = np.random.uniform(2, 120)
        rainfall = np.random.uniform(5, 120)
        drainage_density = np.random.uniform(0.2, 3.5)
        storm_proximity = np.random.uniform(10, 800)
        land_use = np.random.choice(land_uses, p=[0.3, 0.3, 0.25, 0.15])
        soil_group = np.random.choice(soil_groups, p=[0.2, 0.3, 0.3, 0.2])
        drain_type = np.random.choice(drain_types)

        score = 0.0
        if rainfall > 70: score += 0.35
        elif rainfall > 40: score += 0.20
        elif rainfall > 20: score += 0.10
        if elevation < 15: score += 0.30
        elif elevation < 40: score += 0.15
        if land_use == "Urban": score += 0.15
        if soil_group == "Group D": score += 0.10
        if storm_proximity > 400: score += 0.10

        # Add noise
        score += np.random.normal(0, 0.05)

        if score >= 0.55: risk = "High"
        elif score >= 0.30: risk = "Medium"
        else: risk = "Low"

        data.append({
            "latitude": round(np.random.uniform(12.2, 12.4), 6),
            "longitude": round(np.random.uniform(76.5, 76.7), 6),
            "elevation_m": round(elevation, 2),
            "land_use": land_use,
            "soil_group": soil_group,
            "drainage_density_km_per_km2": round(drainage_density, 2),
            "storm_drain_proximity_m": round(storm_proximity, 2),
            "storm_drain_type": drain_type,
            "historical_rainfall_intensity_mm_hr": round(rainfall, 2),
            "risk": risk,
        })

    df = pd.DataFrame(data)
    df["runoff_index"] = df["historical_rainfall_intensity_mm_hr"] / (df["elevation_m"] + 1.0)
    df["drainage_inefficiency"] = df["storm_drain_proximity_m"] / (df["drainage_density_km_per_km2"] + 0.1)
    return df


def preprocess(df):
    label_encoder = LabelEncoder()
    y = label_encoder.fit_transform(df["risk"])

    numeric_features = [
        "latitude", "longitude", "elevation_m",
        "drainage_density_km_per_km2", "storm_drain_proximity_m",
        "historical_rainfall_intensity_mm_hr", "runoff_index", "drainage_inefficiency"
    ]
    categorical_features = ["land_use", "soil_group", "storm_drain_type"]

    X_num = df[numeric_features].values.astype(float)
    X_cat = pd.get_dummies(df[categorical_features], drop_first=False).values.astype(float)
    X_raw = np.hstack([X_num, X_cat])

    scaler = StandardScaler()
    X_processed = scaler.fit_transform(X_raw)
    feature_names = numeric_features + list(
        pd.get_dummies(df[categorical_features], drop_first=False).columns
    )

    return X_processed, y, label_encoder, scaler, feature_names


# ====================
# Conformal Prediction
# ====================
class ConformalClassifier:
    def __init__(self, model, alpha=0.1):
        self.model = model
        self.alpha = alpha
        self.q_hat = None

    def calibrate(self, X_cal, y_cal):
        probs = self.model.predict_proba(X_cal)
        n = len(y_cal)
        scores = 1 - probs[np.arange(n), y_cal]
        q_level = np.ceil((1 - self.alpha) * (n + 1)) / n
        self.q_hat = np.quantile(scores, q_level, method='higher')
        return self

    def predict(self, X):
        probs = self.model.predict_proba(X)
        point_preds = np.argmax(probs, axis=1)
        prediction_sets = []
        for i in range(len(X)):
            pred_set = [c for c in range(probs.shape[1]) if probs[i, c] >= 1 - self.q_hat]
            prediction_sets.append(pred_set)
        return point_preds, prediction_sets, probs

    def coverage(self, X, y):
        _, pred_sets, _ = self.predict(X)
        return np.mean([y[i] in pred_sets[i] for i in range(len(y))])

    def avg_set_size(self, X):
        _, pred_sets, _ = self.predict(X)
        return np.mean([len(s) for s in pred_sets])


# ====================
# MLP Model (PyTorch)
# ====================
class MLPClassifier(nn.Module):
    def __init__(self, input_dim, n_classes, hidden_dims=(128, 64, 32)):
        super().__init__()
        layers = []
        prev = input_dim
        for h in hidden_dims:
            layers.extend([
                nn.Linear(prev, h),
                nn.BatchNorm1d(h),
                nn.ReLU(),
                nn.Dropout(0.3),
            ])
            prev = h
        layers.append(nn.Linear(prev, n_classes))
        self.net = nn.Sequential(*layers)

    def forward(self, x):
        return self.net(x)


def train_mlp(X_train, y_train, X_val, y_val, n_classes, epochs=100, lr=1e-3, batch_size=64):
    device = torch.device('cuda' if torch.cuda.is_available() else 'cpu')
    model = MLPClassifier(X_train.shape[1], n_classes).to(device)
    optimizer = optim.AdamW(model.parameters(), lr=lr, weight_decay=1e-4)
    scheduler = optim.lr_scheduler.CosineAnnealingLR(optimizer, T_max=epochs)
    criterion = nn.CrossEntropyLoss()

    X_t = torch.FloatTensor(X_train).to(device)
    y_t = torch.LongTensor(y_train).to(device)
    X_v = torch.FloatTensor(X_val).to(device)
    y_v = torch.LongTensor(y_val).to(device)

    dataset = TensorDataset(X_t, y_t)
    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True)

    best_val_acc = 0
    best_state = None

    for epoch in range(epochs):
        model.train()
        for xb, yb in loader:
            optimizer.zero_grad()
            loss = criterion(model(xb), yb)
            loss.backward()
            optimizer.step()
        scheduler.step()

        model.eval()
        with torch.no_grad():
            val_acc = (model(X_v).argmax(1) == y_v).float().mean().item()
            if val_acc > best_val_acc:
                best_val_acc = val_acc
                best_state = {k: v.cpu().clone() for k, v in model.state_dict().items()}

    model.load_state_dict(best_state)
    model.eval()
    return model


def mlp_predict_proba(model, X, n_classes, batch_size=256):
    device = next(model.parameters()).device
    model.eval()
    probs = []
    with torch.no_grad():
        for i in range(0, len(X), batch_size):
            xb = torch.FloatTensor(X[i:i+batch_size]).to(device)
            p = torch.softmax(model(xb), dim=1).cpu().numpy()
            probs.append(p)
    return np.vstack(probs)


# ====================
# Main Experiment
# ====================
def run():
    print("=" * 70)
    print("Flood Risk ML Model Comparison + Conformal Prediction")
    print("=" * 70)

    # Generate data
    print("\n[1] Generating dataset (2000 samples)...")
    df = generate_dataset(n_samples=2000)
    print(f"    Class distribution:\n{df['risk'].value_counts().to_string()}")

    # Preprocess
    print("\n[2] Preprocessing...")
    X, y, le, scaler, feature_names = preprocess(df)
    n_classes = len(np.unique(y))

    X_train_full, X_test, y_train_full, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )
    X_train, X_cal, y_train, y_cal = train_test_split(
        X_train_full, y_train_full, test_size=0.15, random_state=42, stratify=y_train_full
    )
    print(f"    Train: {len(X_train)}, Cal: {len(X_cal)}, Test: {len(X_test)}")
    print(f"    Features: {X.shape[1]}")

    # Define models
    models = {
        "XGBoost": xgb.XGBClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, eval_metric="mlogloss",
            random_state=42, use_label_encoder=False
        ),
        "RandomForest": RandomForestClassifier(
            n_estimators=200, max_depth=10, random_state=42, n_jobs=-1
        ),
        "ExtraTrees": ExtraTreesClassifier(
            n_estimators=200, max_depth=10, random_state=42, n_jobs=-1
        ),
        "GradientBoosting": GradientBoostingClassifier(
            n_estimators=200, max_depth=5, learning_rate=0.05, random_state=42
        ),
    }

    if HAS_LGB:
        models["LightGBM"] = lgb.LGBMClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.05,
            subsample=0.8, colsample_bytree=0.8, random_state=42,
            verbose=-1
        )

    results = []

    for name, model in models.items():
        print(f"\n[3] Training {name}...")
        t0 = time.time()
        model.fit(X_train, y_train)
        train_time = time.time() - t0

        # Point predictions
        y_pred = model.predict(X_test)
        acc = accuracy_score(y_test, y_pred)
        f1 = f1_score(y_test, y_pred, average='macro')

        # Probabilities for conformal
        probs = model.predict_proba(X_test)

        # AUC (One-vs-Rest)
        try:
            auc = roc_auc_score(y_test, probs, multi_class='ovr', average='macro')
        except:
            auc = 0.0

        # Log loss
        ll = log_loss(y_test, probs)

        # Conformal prediction
        cc = ConformalClassifier(model, alpha=0.1)
        cc.calibrate(X_cal, y_cal)
        coverage = cc.coverage(X_test, y_test)
        avg_set = cc.avg_set_size(X_test)

        # Inference latency
        t0 = time.time()
        for _ in range(100):
            model.predict(X_test[:1])
        latency_ms = (time.time() - t0) / 100 * 1000

        # Model size (approximate)
        import pickle
        model_bytes = len(pickle.dumps(model))
        model_kb = model_bytes / 1024

        result = {
            "model": name,
            "accuracy": round(acc, 4),
            "macro_f1": round(f1, 4),
            "auc_roc": round(auc, 4),
            "log_loss": round(ll, 4),
            "conformal_coverage": round(coverage, 4),
            "avg_pred_set_size": round(avg_set, 4),
            "train_time_s": round(train_time, 3),
            "inference_latency_ms": round(latency_ms, 3),
            "model_size_kb": round(model_kb, 1),
        }
        results.append(result)

        print(f"    Accuracy: {acc:.4f} | F1: {f1:.4f} | AUC: {auc:.4f}")
        print(f"    Conformal: coverage={coverage:.4f} (target 90%), set_size={avg_set:.4f}")
        print(f"    Train: {train_time:.3f}s | Inference: {latency_ms:.3f}ms | Size: {model_kb:.1f}KB")

    # Train MLP
    print(f"\n[3b] Training MLP...")
    t0 = time.time()
    mlp_model = train_mlp(X_train, y_train, X_cal, y_cal, n_classes, epochs=100)
    train_time_mlp = time.time() - t0

    mlp_probs = mlp_predict_proba(mlp_model, X_test, n_classes)
    mlp_pred = np.argmax(mlp_probs, axis=1)
    mlp_acc = accuracy_score(y_test, mlp_pred)
    mlp_f1 = f1_score(y_test, mlp_pred, average='macro')
    try:
        mlp_auc = roc_auc_score(y_test, mlp_probs, multi_class='ovr', average='macro')
    except:
        mlp_auc = 0.0
    mlp_ll = log_loss(y_test, mlp_probs)

    # Conformal for MLP (wrap in a predict_proba interface)
    class MLPWrapper:
        def __init__(self, model, n_classes):
            self.model = model
            self.n_classes = n_classes
        def predict_proba(self, X):
            return mlp_predict_proba(self.model, X, self.n_classes)

    mlp_wrapper = MLPWrapper(mlp_model, n_classes)
    cc_mlp = ConformalClassifier(mlp_wrapper, alpha=0.1)
    cc_mlp.calibrate(X_cal, y_cal)
    mlp_coverage = cc_mlp.coverage(X_test, y_test)
    mlp_avg_set = cc_mlp.avg_set_size(X_test)

    results.append({
        "model": "MLP (PyTorch)",
        "accuracy": round(mlp_acc, 4),
        "macro_f1": round(mlp_f1, 4),
        "auc_roc": round(mlp_auc, 4),
        "log_loss": round(mlp_ll, 4),
        "conformal_coverage": round(mlp_coverage, 4),
        "avg_pred_set_size": round(mlp_avg_set, 4),
        "train_time_s": round(train_time_mlp, 3),
        "inference_latency_ms": 0,
        "model_size_kb": 0,
    })

    # Summary table
    print("\n" + "=" * 70)
    print("RESULTS SUMMARY")
    print("=" * 70)
    header = f"{'Model':<20} {'Acc':<8} {'F1':<8} {'AUC':<8} {'Cov':<8} {'SetSz':<8} {'Train(s)':<10} {'Size(KB)':<10}"
    print(header)
    print("-" * len(header))
    for r in sorted(results, key=lambda x: x["macro_f1"], reverse=True):
        print(f"{r['model']:<20} {r['accuracy']:<8.4f} {r['macro_f1']:<8.4f} {r['auc_roc']:<8.4f} "
              f"{r['conformal_coverage']:<8.4f} {r['avg_pred_set_size']:<8.4f} "
              f"{r['train_time_s']:<10.3f} {r['model_size_kb']:<10.1f}")

    best = max(results, key=lambda x: x["macro_f1"])
    print(f"\nBest model: {best['model']} (F1={best['macro_f1']:.4f})")

    # Save results
    with open(os.path.join(OUTPUT_DIR, "model_comparison.json"), "w") as f:
        json.dump(results, f, indent=2)
    print(f"\nResults saved to {OUTPUT_DIR}/model_comparison.json")

    return results


if __name__ == "__main__":
    results = run()
