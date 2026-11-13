// Downloads all-MiniLM-L6-v2 (ONNX) from Hugging Face into models/ for local, offline embeddings.
const fs = require('fs');
const path = require('path');
const BASE = 'https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/main/';
const FILES = ['config.json', 'tokenizer.json', 'tokenizer_config.json', 'onnx/model.onnx'];
const dir = path.join(__dirname, '..', 'models', 'all-MiniLM-L6-v2');
(async () => {
  for (const f of FILES) {
    const out = path.join(dir, f);
    if (fs.existsSync(out)) { console.log('have', f); continue; }
    fs.mkdirSync(path.dirname(out), { recursive: true });
    const res = await fetch(BASE + f);
    if (!res.ok) throw new Error(`${f}: HTTP ${res.status}`);
    fs.writeFileSync(out, Buffer.from(await res.arrayBuffer()));
    console.log('got', f);
  }
})().catch((e) => { console.error('Download failed:', e.message); process.exit(1); });
