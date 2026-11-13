# ConceptReel

High school concepts explained as short, narrated explainer videos. Videos are shared and reused across learners, ranked by how much they actually helped, and any confusing moment can be turned into a bespoke deep-dive video.

Built for the Multi-Modal AI for Education Hackathon (Beta Fund × Epic, Snowflake). Modalities: text + spoken narration (audio) + animated visuals (video), plus a quiz to measure learning.

## Run it (Python FastAPI backend)

```bash
python3 -m venv .venv && source .venv/bin/activate
pip install -r backend/requirements.txt
python -m spacy download en_core_web_sm   # POS tagger + dependency parser for the knowledge graph
cd backend
python -m app.fetch_model                  # once: all-MiniLM-L6-v2 (~90 MB) from Hugging Face for local embeddings
uvicorn app.main:app --port 3000           # http://localhost:3000
```

That runs with zero setup: data in `data/db.json`, vectors in memory. To use the databases:

```bash
docker compose up -d                       # from the project root: MongoDB on 27017, Weaviate on 8080/50051
cd backend && cp .env.example .env         # MONGODB_URI, WEAVIATE_URL (and optionally ANTHROPIC_API_KEY)
uvicorn app.main:app --port 3000 --env-file .env
```

The startup log says where things live, e.g. `vectors in weaviate (0 embedded) ... Data in mongodb`. On the first run against an empty MongoDB, an existing `data/db.json` is imported (otherwise the library is seeded). If `MONGODB_URI` or `WEAVIATE_URL` is set but the server is unreachable, startup stops with a clear error instead of silently falling back.

Without the model files the app still runs; the "meaning" ranking falls back to keyword (TF-IDF) similarity.

No keys needed. Without `ANTHROPIC_API_KEY` the app runs in **offline mode**: the seeded library works fully, and new videos are built from text the learner pastes or from a photo of a printed page (read with RapidOCR, bundled ONNX models, no download). Handwriting and diagrams need the key, since Claude reads those. With a key, Claude writes every new storyboard and deep dive, from the topic alone.

Reset demo data with `curl -X POST localhost:3000/api/reset` (clears MongoDB and Weaviate too when they're in use).

The original Node/Express backend is kept as a fallback (`npm install && npm run fetch-model && npm start`); it only supports the JSON file store.

## Storage

| What | Where (configured) | Fallback |
|---|---|---|
| Videos and deep dives (storyboard, stats, concept-map summary), users (tokens, reactions, quiz history), metrics | MongoDB: `videos`, `users`, `meta` collections | `data/db.json` |
| Interaction log (view, complete, like, quiz) | MongoDB `events` collection | last 5,000 in `data/db.json` |
| Vectors: one per video header (title + summary + tags) and one per transcript scene, with a content hash | Weaviate collection `VideoChunk` (self-provided vectors, HNSW, cosine) | process memory |
| Knowledge graph per video: every concept node (with weight) and typed relation edge from its transcript, plus a hash of the text and extractor version | MongoDB `knowledge_graphs` collection (a compact 14-concept summary is also on each video for the concept map) | rebuilt with spaCy at startup |
| Uploaded photos | `data/uploads/` on disk | same |

Search embeds the query locally and runs a Weaviate near-vector query to get each video's best header and scene similarity; the knowledge-graph and learner rankings are then fused with RRF as before. On restart only videos whose text changed are re-embedded and re-parsed into graphs (the log shows how many). The API keeps a write-through in-memory copy of videos and users (loaded at startup) so ranking doesn't query MongoDB per request; every change is written to MongoDB immediately. Code: `backend/app/store.py`, `backend/app/vectors.py`.

## What's in this release

| Feature | Where |
|---|---|
| Concept search that reuses saved videos (free) | `backend/app/semantic.py`, `GET /api/search` |
| Closest matches shown first, learner chooses to generate new | `public/app.js` → `renderSearch` |
| Ranking by learner interaction (quiz accuracy, finish rate, likes, clarity) | `backend/app/ranking.py` |
| Select a timestamp → bespoke "explain this part" video, reused for the next learner who gets stuck there | `POST /api/videos/:id/explain` |
| "Where others got stuck" heatmap on the timeline | `stats.confusedScenes` |
| Weekly token budget (100/week, new video 30, deep dive 10, reuse free) | `backend/app/main.py` (`COST`, `WEEKLY_TOKENS`) |
| Check-for-understanding quiz after each video (the measurable outcome) | `renderQuiz` |
| Start from a photo: textbook page, diagram, screenshot or handwritten notes (upload, paste or drop). The app reads it, shows saved videos for that concept first, then can make a new video from it | `backend/app/vision.py`, `POST /api/read-image` |

Next release (not built): personalization by level and language, and earning tokens by helping others.

## How matching works (semantic + knowledge graph, fused with RRF)

Search, the photo flow and "other versions" all go through `backend/app/semantic.py`, which ranks videos three ways and fuses them with Reciprocal Rank Fusion: `RRF(v) = Σ w / (60 + rank)`.

1. **Meaning** (weight 1): cosine similarity of local sentence embeddings (all-MiniLM-L6-v2 on ONNX Runtime, CPU, no API). The query is compared with each video's title/summary vector and with every scene of its transcript; the best wins.
2. **Concept graph** (weight 1): `backend/app/kg.py` POS-tags and dependency-parses text with spaCy and builds a knowledge graph. Noun chunks become concept nodes; subject–verb–object, verb + preposition, passive agents, noun–preposition–noun and "is/called" links become typed relations (`plant —make→ food`, `glucose —into→ pyruvate`); adjective-modified concepts get an `is a` edge to their head noun. Every video's transcript is turned into a graph when it's seeded, generated or created as a deep dive. The query (or photo text) gets the same treatment, plus entity linking against concepts the library already knows. The match score blends concept alignment (exact, word overlap, or embedding similarity of the labels, weighted by centrality and IDF), relation alignment (query triples found in the video), and paths (query concepts the video links within two hops).
3. **Learners** (weight 0.5): the interaction ranking (quiz accuracy, finish rate, likes, clarity).

Only videos above a relevance floor on meaning (or graph backed by some meaning) are ranked, so popularity can't pull in an unrelated video. Each result shows both scores and the shared concepts; each video page shows its concept map.

## Guardrails, grade levels and checkpoints

Built from the K-12 Guardrail Prompt Pack:

- **Grade bands** (`backend/app/grades.py`): K-2, 3-5, 6-8, 9-12 with reading level, max sentence length, scenes, key points, deep-dive depth, checkpoint count and answer options. Every learner has a grade, set at onboarding (demo learners: Maya 9, Leo 11, Priya 7). Learners only see lessons for their band or younger; search adds a fourth RRF list for grade fit.
- **Prompts** (`backend/app/prompts.py`): the shared Compliance Block is the system prompt; the task, `<topic>`, `<source>` and `<question>` go in the user turn only. Intake screen (Prompt 1) for photos, deep-dive scope (Prompt 3), checkpoint question rules (Prompt 4) and an independent review call (Prompt 5). Bump `PROMPT_VERSION` when you edit them.
- **Release decision** (`backend/app/release.py`): input moderation, output moderation (word lists in `safety_terms.json`), answer-key validation and the review must all PASS. REVISE retries once with the reviewer's fix notes; anything else fails closed with the pack's student-facing message and no tokens spent. Every decision is logged with prompt version and model, without student names. `REVIEW=off` skips the review call; `REQUIRE_TEACHER_APPROVAL=1` holds sensitive-topic lessons.
- **Distress signals** (typed text or handwriting in a photo) stop the flow and show the trusted-adult / 988 message.
- **Checkpoints**: key scenes carry a question. The player pauses after the scene; a first miss gets feedback and a hint, a second miss shows the explanation plus "Rewatch" and "Explain this part". First-try results feed quiz accuracy, and misses light up the "where learners got stuck" heatmap.
- Prompt 6 (rendered video check) isn't needed: videos are drawn in the browser straight from the approved script, with no image, video or voice model in the loop.

## How a "video" works

A video is a storyboard: scenes with narration, a visual (icons, flow, equation, comparison, timeline) and a quiz. The browser renders it as an animated video and narrates it with the Web Speech API. Generating one is a single LLM call, which is far cheaper than pixel-level video generation, and that cost gap is what makes the weekly token budget generous.

## Demo script (2 minutes)

1. Search "how do plants make food" → closest matches, ranked, watch free.
2. Play, then drag across the timeline over "Chlorophyll catches the light" → **Explain this part** (10 tokens) → deep dive.
3. Switch learner to Leo, select the same part → it's free, because Maya already asked.
4. Finish the video, take the quiz → the score feeds the ranking.
5. Tap **Snap or upload a page** and add a photo of a textbook paragraph on photosynthesis → it finds the saved video, free. A photo of a new topic → make a video from it.
6. Search "Krebs cycle" → no exact match, closest shown → paste a paragraph → generate (30 tokens). Search "krebs" again → now free for everyone.

## Stack

Python 3.11+, FastAPI + Uvicorn, MongoDB (or a JSON file), Weaviate (or in-memory vectors), vanilla JS front end. spaCy (en_core_web_sm) for POS tagging and dependency parsing, ONNX Runtime + tokenizers for embeddings, RapidOCR for offline OCR, the Anthropic Python SDK (structured outputs) for generation.
