from fastapi import FastAPI
from pydantic import BaseModel
from sentence_transformers import SentenceTransformer
import numpy as np
import json
import os
import sys

if sys.platform == "win32":
    import codecs
    sys.stdout = codecs.getwriter('utf-8')(sys.stdout.buffer, 'strict')
    sys.stderr = codecs.getwriter('utf-8')(sys.stderr.buffer, 'strict')

os.environ["PYTHONIOENCODING"] = "utf-8"
from typing import Optional, List

app = FastAPI(title="Intent Model Service", description="轻量级意图分类模型服务")

MODEL_NAME = "paraphrase-multilingual-MiniLM-L12-v2"
DATA_DIR = os.path.join(os.path.dirname(__file__), "data")
INTENTS_FILE = os.path.join(DATA_DIR, "intents.json")

model = None
intent_vectors = []
intent_data = []


class ClassifyRequest(BaseModel):
    text: str


class IntentExample(BaseModel):
    text: str
    intent: str
    category: str


class SimilarityRequest(BaseModel):
    query: str
    candidates: List[str]
    top_k: int = 5


class EmbedRequest(BaseModel):
    text: str


def load_intents():
    global intent_vectors, intent_data
    if not os.path.exists(INTENTS_FILE):
        print(f"[intent-model] No intents file at {INTENTS_FILE}, using defaults")
        return
    with open(INTENTS_FILE, "r", encoding="utf-8") as f:
        intents = json.load(f)
    intent_data = intents
    print(f"[intent-model] Loaded {len(intents)} intent examples")
    if model and intents:
        texts = [item["text"] for item in intents]
        intent_vectors = model.encode(texts, convert_to_numpy=True).tolist()
        print(f"[intent-model] Encoded {len(intent_vectors)} vectors")


def cosine_similarity(a: list, b: list) -> float:
    a = np.array(a)
    b = np.array(b)
    if np.linalg.norm(a) == 0 or np.linalg.norm(b) == 0:
        return 0.0
    return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))


@app.on_event("startup")
def startup():
    global model
    print(f"[intent-model] Loading model {MODEL_NAME}...")
    model = SentenceTransformer(MODEL_NAME)
    print(f"[intent-model] Model loaded")
    load_intents()


@app.get("/health")
def health():
    return {"status": "ok", "model": MODEL_NAME}


@app.post("/classify")
def classify(req: ClassifyRequest):
    if not model:
        return {"error": "Model not loaded"}

    text = req.text.strip()
    if not text:
        return {"intent": "command", "score": 0.5, "method": "empty"}

    query_vector = model.encode([text], convert_to_numpy=True)[0].tolist()

    if not intent_vectors:
        return {"intent": "command", "score": 0.5, "method": "no_data"}

    scores = []
    for iv in intent_vectors:
        sim = cosine_similarity(query_vector, iv)
        scores.append(sim)

    best_idx = int(np.argmax(scores))
    best_score = float(scores[best_idx])
    best_intent = intent_data[best_idx]["intent"]

    method = "semantic_vector"
    if best_score < 0.3:
        method = "low_confidence"
        best_intent = "command"

    return {
        "intent": best_intent,
        "score": round(best_score, 3),
        "method": method,
        "matched_text": intent_data[best_idx]["text"],
        "category": intent_data[best_idx]["category"],
    }


@app.post("/similarity")
def similarity(req: SimilarityRequest):
    if not model:
        return {"error": "Model not loaded"}

    query = req.query.strip()
    candidates = [item.strip() for item in req.candidates if item and item.strip()]
    if not query or not candidates:
        return {"matches": []}

    query_vector = model.encode([query], convert_to_numpy=True)[0].tolist()
    candidate_vectors = model.encode(candidates, convert_to_numpy=True).tolist()

    scored = []
    for index, vector in enumerate(candidate_vectors):
        scored.append({
            "index": index,
            "score": round(cosine_similarity(query_vector, vector), 3),
            "text": candidates[index],
        })

    scored.sort(key=lambda item: item["score"], reverse=True)
    return {"matches": scored[: max(req.top_k, 1)]}


@app.post("/embed")
def embed(req: EmbedRequest):
    if not model:
        return {"error": "Model not loaded"}

    text = req.text.strip()
    if not text:
        return {"embedding": [], "dimension": 0}

    vector = model.encode([text], convert_to_numpy=True)[0].tolist()
    return {
        "embedding": vector,
        "dimension": len(vector),
        "model": MODEL_NAME,
    }


@app.post("/reload")
def reload():
    load_intents()
    return {"status": "reloaded", "count": len(intent_data)}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8001)
