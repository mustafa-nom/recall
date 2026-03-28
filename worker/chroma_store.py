"""
ChromaDB storage for the Agent Hub.

Stores verified shortcuts with embeddings for semantic retrieval.
Uses Gemini embeddings via google-generativeai.
"""

import json
import os
import time
import uuid
from typing import Optional

import chromadb
from google import genai

COLLECTION_NAME = "recall_shortcuts"
EMBEDDING_MODEL = "gemini-embedding-001"


def _get_client() -> chromadb.ClientAPI:
    """Get ChromaDB client — uses persistent local storage."""
    persist_dir = os.path.join(os.path.dirname(__file__), "data", "chroma")
    os.makedirs(persist_dir, exist_ok=True)
    return chromadb.PersistentClient(path=persist_dir)


def _get_collection() -> chromadb.Collection:
    """Get or create the shortcuts collection."""
    client = _get_client()
    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        metadata={"hnsw:space": "cosine"},
    )


def _get_genai_client() -> genai.Client:
    return genai.Client(api_key=os.environ.get("GEMINI_API_KEY", ""))


def _embed(text: str) -> list[float]:
    """Generate embedding using Gemini."""
    client = _get_genai_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
    )
    return result.embeddings[0].values


def _embed_query(text: str) -> list[float]:
    """Generate query embedding using Gemini."""
    client = _get_genai_client()
    result = client.models.embed_content(
        model=EMBEDDING_MODEL,
        contents=text,
    )
    return result.embeddings[0].values


def store_suggestion(
    task_pattern: str,
    suggestion: str,
    how: str,
    when: str,
    category: str,
    site_domain: str = "",
    estimated_impact: str = "medium",
    source_run_id: str = "",
) -> dict:
    """Store a new shortcut in ChromaDB. Returns the stored shortcut."""
    collection = _get_collection()

    # Generate ID
    shortcut_id = f"sc-{uuid.uuid4().hex[:12]}"

    # Build embedding text from key fields
    embed_text = f"{task_pattern} {suggestion} {how}"
    embedding = _embed(embed_text)

    # Check for semantic duplicates (similarity > 0.70) or same domain + similar suggestion
    try:
        existing = collection.query(
            query_embeddings=[embedding],
            n_results=3,
        )
        if existing["distances"] and existing["distances"][0]:
            for i, dist in enumerate(existing["distances"][0]):
                if dist > 0.30:  # cosine distance > 0.30 = similarity < 0.70
                    continue

                existing_meta = existing["metadatas"][0][i] if existing["metadatas"][0] else {}

                # Extra check: if distance is between 0.15-0.30, require same domain
                if dist > 0.15 and site_domain and existing_meta.get("site_domain", "") != site_domain:
                    continue

                # Match found — update existing
                existing_id = existing["ids"][0][i]
                run_count = int(existing_meta.get("run_count", "1")) + 1

                # Update with latest info
                updated_meta = {
                    **existing_meta,
                    "run_count": str(run_count),
                    "updated_at": str(int(time.time())),
                }
                # Update task_pattern if new one is longer/more descriptive
                if len(task_pattern) > len(existing_meta.get("task_pattern", "")):
                    updated_meta["task_pattern"] = task_pattern
                # Update domain if was "unknown" and now we have a real one
                if site_domain and existing_meta.get("site_domain", "") in ("", "unknown"):
                    updated_meta["site_domain"] = site_domain

                collection.update(ids=[existing_id], metadatas=[updated_meta])
                return {
                    "id": existing_id,
                    "action": "updated",
                    "run_count": run_count,
                }
    except Exception:
        pass  # No existing results, proceed with insert

    now = str(int(time.time()))
    metadata = {
        "task_pattern": task_pattern,
        "suggestion": suggestion,
        "how": how,
        "when": when,
        "category": category,
        "site_domain": site_domain,
        "estimated_impact": estimated_impact,
        "source_run_id": source_run_id,
        "run_count": "1",
        "success_associations": "0",
        "created_at": now,
        "updated_at": now,
    }

    collection.add(
        ids=[shortcut_id],
        embeddings=[embedding],
        documents=[embed_text],
        metadatas=[metadata],
    )

    return {"id": shortcut_id, "action": "created", **metadata}


def query_suggestions(task: str, top_k: int = 5) -> list[dict]:
    """Query ChromaDB for relevant shortcuts given a task description."""
    collection = _get_collection()

    if collection.count() == 0:
        return []

    embedding = _embed_query(task)

    results = collection.query(
        query_embeddings=[embedding],
        n_results=min(top_k, collection.count()),
    )

    shortcuts = []
    for i, doc_id in enumerate(results["ids"][0]):
        distance = results["distances"][0][i] if results["distances"] else 1.0
        relevance = 1.0 - distance  # Convert distance to similarity

        if relevance < 0.3:  # Skip low relevance
            continue

        meta = results["metadatas"][0][i] if results["metadatas"] else {}
        shortcut = {
                "id": doc_id,
                "taskPattern": meta.get("task_pattern", ""),
                "suggestion": meta.get("suggestion", ""),
                "how": meta.get("how", ""),
                "when": meta.get("when", ""),
                "category": meta.get("category", "speed"),
                "siteDomain": meta.get("site_domain", ""),
                "estimatedImpact": meta.get("estimated_impact", "medium"),
                "runCount": int(meta.get("run_count", "1")),
                "successAssociations": int(
                    meta.get("success_associations", "0")
                ),
                "sourceRunId": meta.get("source_run_id", ""),
                "createdAt": meta.get("created_at", ""),
                "updatedAt": meta.get("updated_at", ""),
                "relevance": round(relevance, 3),
            }
        if meta.get("ab_winner"):
            shortcut["abResult"] = _extract_ab_result(meta)
        shortcuts.append(shortcut)

    return shortcuts


def list_all_shortcuts(
    category: Optional[str] = None,
    domain: Optional[str] = None,
) -> list[dict]:
    """List all shortcuts, optionally filtered."""
    collection = _get_collection()

    if collection.count() == 0:
        return []

    # Build where filter
    where = None
    if category:
        where = {"category": category}
    elif domain:
        where = {"site_domain": domain}

    results = collection.get(where=where) if where else collection.get()

    shortcuts = []
    for i, doc_id in enumerate(results["ids"]):
        meta = results["metadatas"][i] if results["metadatas"] else {}
        shortcut = {
                "id": doc_id,
                "taskPattern": meta.get("task_pattern", ""),
                "suggestion": meta.get("suggestion", ""),
                "how": meta.get("how", ""),
                "when": meta.get("when", ""),
                "category": meta.get("category", "speed"),
                "siteDomain": meta.get("site_domain", ""),
                "estimatedImpact": meta.get("estimated_impact", "medium"),
                "runCount": int(meta.get("run_count", "1")),
                "successAssociations": int(
                    meta.get("success_associations", "0")
                ),
                "sourceRunId": meta.get("source_run_id", ""),
                "createdAt": meta.get("created_at", ""),
                "updatedAt": meta.get("updated_at", ""),
            }
        if meta.get("ab_winner"):
            shortcut["abResult"] = _extract_ab_result(meta)
        shortcuts.append(shortcut)

    return shortcuts


def get_stats() -> dict:
    """Get aggregate Hub statistics."""
    shortcuts = list_all_shortcuts()
    categories = {"speed": 0, "accuracy": 0, "cost": 0}
    top_shortcut = None
    max_runs = 0

    for s in shortcuts:
        cat = s.get("category", "speed")
        if cat in categories:
            categories[cat] += 1
        runs = s.get("runCount", 0)
        if runs > max_runs:
            max_runs = runs
            top_shortcut = s

    return {
        "totalShortcuts": len(shortcuts),
        "categories": categories,
        "topShortcut": top_shortcut,
    }


def search_shortcuts(query: str, top_k: int = 10) -> list[dict]:
    """Semantic search across all shortcuts."""
    return query_suggestions(query, top_k=top_k)


def get_shortcut_by_id(shortcut_id: str) -> dict | None:
    """Look up a single shortcut by ID."""
    collection = _get_collection()
    try:
        results = collection.get(ids=[shortcut_id])
        if not results["ids"]:
            return None
        meta = results["metadatas"][0] if results["metadatas"] else {}
        shortcut = {
            "id": results["ids"][0],
            "taskPattern": meta.get("task_pattern", ""),
            "suggestion": meta.get("suggestion", ""),
            "how": meta.get("how", ""),
            "when": meta.get("when", ""),
            "category": meta.get("category", "speed"),
            "siteDomain": meta.get("site_domain", ""),
            "estimatedImpact": meta.get("estimated_impact", "medium"),
            "runCount": int(meta.get("run_count", "1")),
            "successAssociations": int(meta.get("success_associations", "0")),
            "sourceRunId": meta.get("source_run_id", ""),
            "createdAt": meta.get("created_at", ""),
            "updatedAt": meta.get("updated_at", ""),
        }
        # Include AB result if present
        if meta.get("ab_winner"):
            shortcut["abResult"] = _extract_ab_result(meta)
        return shortcut
    except Exception:
        return None


def update_shortcut_ab_result(shortcut_id: str, ab_result: dict) -> bool:
    """Store A/B test result on a shortcut's metadata."""
    collection = _get_collection()
    try:
        existing = collection.get(ids=[shortcut_id])
        if not existing["ids"]:
            return False
        meta = existing["metadatas"][0] if existing["metadatas"] else {}
        # ChromaDB metadata values must be str/int/float — flatten ABResult
        meta["ab_winner"] = ab_result["winner"]
        meta["ab_baseline_steps"] = str(ab_result["baselineSteps"])
        meta["ab_baseline_time_ms"] = str(ab_result["baselineTimeMs"])
        meta["ab_baseline_success"] = str(ab_result["baselineSuccess"])
        meta["ab_trained_steps"] = str(ab_result["trainedSteps"])
        meta["ab_trained_time_ms"] = str(ab_result["trainedTimeMs"])
        meta["ab_trained_success"] = str(ab_result["trainedSuccess"])
        meta["ab_improvement_pct"] = str(ab_result["improvementPct"])
        meta["ab_steps_saved"] = str(ab_result["stepsSaved"])
        meta["ab_time_saved_ms"] = str(ab_result["timeSavedMs"])
        meta["updated_at"] = str(int(time.time()))
        collection.update(ids=[shortcut_id], metadatas=[meta])
        return True
    except Exception:
        return False


def _extract_ab_result(meta: dict) -> dict:
    """Extract ABResult from flattened ChromaDB metadata."""
    return {
        "baselineSteps": int(meta.get("ab_baseline_steps", "0")),
        "baselineTimeMs": int(meta.get("ab_baseline_time_ms", "0")),
        "baselineSuccess": meta.get("ab_baseline_success", "False") == "True",
        "trainedSteps": int(meta.get("ab_trained_steps", "0")),
        "trainedTimeMs": int(meta.get("ab_trained_time_ms", "0")),
        "trainedSuccess": meta.get("ab_trained_success", "False") == "True",
        "winner": meta.get("ab_winner", "tie"),
        "improvementPct": int(meta.get("ab_improvement_pct", "0")),
        "stepsSaved": int(meta.get("ab_steps_saved", "0")),
        "timeSavedMs": int(meta.get("ab_time_saved_ms", "0")),
    }
