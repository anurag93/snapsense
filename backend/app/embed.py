"""Local sentence embeddings: all-MiniLM-L6-v2 (384-dim, mean pooled, L2-normalised) on CPU via ONNX Runtime.

No network and no paid API at query time. Model files live in /models/all-MiniLM-L6-v2
(`python -m app.fetch_model` or `npm run fetch-model` downloads them).
"""
import threading
from pathlib import Path

import numpy as np

MODEL_DIR = Path(__file__).resolve().parents[2] / "models" / "all-MiniLM-L6-v2"
_lock = threading.Lock()
_session = None
_tokenizer = None
_cache: dict[str, np.ndarray] = {}


def available() -> bool:
    return (MODEL_DIR / "onnx" / "model.onnx").exists() and (MODEL_DIR / "tokenizer.json").exists()


def _load():
    global _session, _tokenizer
    if _session is None:
        import onnxruntime as ort
        from tokenizers import Tokenizer
        _tokenizer = Tokenizer.from_file(str(MODEL_DIR / "tokenizer.json"))
        _tokenizer.enable_truncation(max_length=256)
        _tokenizer.enable_padding(pad_id=0, pad_token="[PAD]")
        opts = ort.SessionOptions()
        opts.intra_op_num_threads = 2
        _session = ort.InferenceSession(str(MODEL_DIR / "onnx" / "model.onnx"), opts, providers=["CPUExecutionProvider"])
    return _session, _tokenizer


def _encode(texts: list[str]) -> np.ndarray:
    session, tok = _load()
    enc = tok.encode_batch(texts)
    ids = np.array([e.ids for e in enc], dtype=np.int64)
    mask = np.array([e.attention_mask for e in enc], dtype=np.int64)
    feeds = {"input_ids": ids, "attention_mask": mask}
    if "token_type_ids" in {i.name for i in session.get_inputs()}:
        feeds["token_type_ids"] = np.zeros_like(ids)
    hidden = session.run(None, feeds)[0]  # (batch, seq, 384)
    m = mask[..., None].astype(np.float32)
    pooled = (hidden * m).sum(1) / np.clip(m.sum(1), 1e-9, None)
    return pooled / np.clip(np.linalg.norm(pooled, axis=1, keepdims=True), 1e-12, None)


def embed(texts: list[str]) -> list[np.ndarray]:
    """Embed strings; cached per string. Thread-safe (ONNX session shared)."""
    todo = list(dict.fromkeys(t for t in texts if t not in _cache))
    if todo:
        with _lock:
            for i in range(0, len(todo), 32):
                batch = todo[i:i + 32]
                vecs = _encode(batch)
                for t, v in zip(batch, vecs):
                    _cache[t] = v.astype(np.float32)
    return [_cache[t] for t in texts]


def cached(text: str):
    return _cache.get(text)


def cosine(a, b) -> float:
    if a is None or b is None:
        return 0.0
    return float(np.dot(a, b))
