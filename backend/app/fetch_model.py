"""Download all-MiniLM-L6-v2 (ONNX) from Hugging Face into models/ for local, offline embeddings.

Run from backend/:  python -m app.fetch_model
"""
import shutil
import ssl
import urllib.request

from .embed import MODEL_DIR

BASE = "https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/"
FILES = ["config.json", "tokenizer.json", "tokenizer_config.json", "onnx/model.onnx"]


def _ssl_context():
    # python.org builds on macOS ship without system certificates; certifi (installed with anthropic/httpx) has them.
    try:
        import certifi
        return ssl.create_default_context(cafile=certifi.where())
    except ImportError:
        return ssl.create_default_context()


if __name__ == "__main__":
    ctx = _ssl_context()
    for f in FILES:
        out = MODEL_DIR / f
        if out.exists():
            print("have", f)
            continue
        out.parent.mkdir(parents=True, exist_ok=True)
        part = out.with_suffix(out.suffix + ".part")
        with urllib.request.urlopen(BASE + f, context=ctx) as r, open(part, "wb") as fh:
            shutil.copyfileobj(r, fh)
        part.replace(out)
        print("got", f)
