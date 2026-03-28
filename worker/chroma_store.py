"""
ChromaDB Cloud storage for the Agent Hub.

Uses Chroma Cloud with hybrid search:
  - Dense embeddings via Chroma Cloud Qwen (semantic similarity)
  - Sparse embeddings via Chroma Cloud Splade (keyword matching)
  - Reciprocal Rank Fusion (RRF) to merge both rankings
"""

import os
import time
import uuid
from typing import Optional

import chromadb
from chromadb import (
    Schema,
    VectorIndexConfig,
    SparseVectorIndexConfig,
    Search,
    K,
    Knn,
)
from chromadb.utils.embedding_functions import (
    ChromaCloudQwenEmbeddingFunction,
    ChromaCloudSpladeEmbeddingFunction,
)
from chromadb.utils.embedding_functions.chroma_cloud_qwen_embedding_function import (
    ChromaCloudQwenEmbeddingModel,
)

COLLECTION_NAME = "recall_shortcuts"


def _get_client() -> chromadb.CloudClient:
    """Get Chroma Cloud client."""
    return chromadb.CloudClient(
        api_key=os.environ["CHROMA_API_KEY"],
        tenant=os.environ["CHROMA_TENANT"],
        database=os.environ["CHROMA_DATABASE"],
    )


def _build_schema() -> Schema:
    """Build collection schema with dense (Qwen) + sparse (Splade) indexes."""
    schema = Schema()

    # Dense vector index (Qwen) — no key needed, auto-managed as #embedding
    dense_ef = ChromaCloudQwenEmbeddingFunction(
        model=ChromaCloudQwenEmbeddingModel.QWEN3_EMBEDDING_0p6B,
        task="retrieval",
    )
    schema.create_index(
        config=VectorIndexConfig(
            source_key=K.DOCUMENT,
            embedding_function=dense_ef,
        ),
    )

    # Sparse vector index (Splade) for keyword-based search
    sparse_ef = ChromaCloudSpladeEmbeddingFunction()
    schema.create_index(
        config=SparseVectorIndexConfig(
            source_key=K.DOCUMENT,
            embedding_function=sparse_ef,
        ),
        key="sparse_embedding",
    )

    return schema


def _get_collection() -> chromadb.Collection:
    """Get or create the shortcuts collection with hybrid search schema."""
    client = _get_client()
    schema = _build_schema()

    return client.get_or_create_collection(
        name=COLLECTION_NAME,
        schema=schema,
    )


def _rrf_score(rank: int, k: int = 60) -> float:
    """Compute RRF score for a rank position. Lower is better."""
    return 1.0 / (k + rank)


def _hybrid_search(query: str, n_results: int = 5, where: Optional[dict] = None) -> dict:
    """
    Hybrid search: dense (Qwen via legacy query) + sparse (Splade via Search API),
    merged with Reciprocal Rank Fusion.
    """
    collection = _get_collection()

    if collection.count() == 0:
        return {"ids": [[]], "distances": [[]], "metadatas": [[]], "documents": [[]]}

    actual_n = min(n_results, collection.count())
    candidate_pool = min(max(actual_n * 5, 50), collection.count())

    # 1. Dense search via legacy query (Qwen embeddings)
    dense_results = collection.query(
        query_texts=[query],
        n_results=candidate_pool,
        where=where,
    )

    # 2. Sparse search via Search API (Splade embeddings)
    sparse_rank = Knn(
        query=query,
        key="sparse_embedding",
        return_rank=True,
        limit=candidate_pool,
    )
    sparse_search = (
        Search()
        .rank(sparse_rank)
        .limit(candidate_pool)
        .select(K.ID, K.SCORE)
    )
    sparse_results = collection.search(sparse_search)
    sparse_rows = sparse_results.rows()[0] if sparse_results.rows() else []

    # 3. Build RRF scores (weight: 60% dense, 40% sparse)
    dense_weight = 0.6
    sparse_weight = 0.4
    rrf_scores: dict[str, float] = {}

    # Dense rankings
    if dense_results["ids"] and dense_results["ids"][0]:
        for rank, doc_id in enumerate(dense_results["ids"][0]):
            rrf_scores[doc_id] = dense_weight * _rrf_score(rank)

    # Sparse rankings
    for rank, row in enumerate(sparse_rows):
        doc_id = row["id"]
        rrf_scores.setdefault(doc_id, 0)
        rrf_scores[doc_id] += sparse_weight * _rrf_score(rank)

    # Sort by RRF score descending (higher = more relevant)
    ranked_ids = sorted(rrf_scores.keys(), key=lambda x: rrf_scores[x], reverse=True)[:actual_n]

    if not ranked_ids:
        return {"ids": [[]], "distances": [[]], "metadatas": [[]], "documents": [[]]}

    # 4. Fetch full metadata for top results
    full_results = collection.get(ids=ranked_ids)
    id_to_idx = {doc_id: i for i, doc_id in enumerate(full_results["ids"])}

    ids = []
    distances = []
    metadatas = []
    documents = []

    for doc_id in ranked_ids:
        idx = id_to_idx.get(doc_id)
        if idx is None:
            continue
        ids.append(doc_id)
        # Convert RRF score to a distance-like value (invert: higher score -> lower distance)
        distances.append(1.0 - rrf_scores[doc_id] * 60)  # Normalize roughly to 0-1
        metadatas.append(full_results["metadatas"][idx] if full_results["metadatas"] else {})
        documents.append(full_results["documents"][idx] if full_results["documents"] else "")

    return {"ids": [ids], "distances": [distances], "metadatas": [metadatas], "documents": [documents]}


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
    """Store a new shortcut in Chroma Cloud. Returns the stored shortcut."""
    collection = _get_collection()

    # Generate ID
    shortcut_id = f"sc-{uuid.uuid4().hex[:12]}"

    # Build document text for embedding
    embed_text = f"{task_pattern} {suggestion} {how}"

    # Check for semantic duplicates via hybrid search
    try:
        results = _hybrid_search(embed_text, n_results=3)
        if results["ids"] and results["ids"][0]:
            for i, doc_id in enumerate(results["ids"][0]):
                dist = results["distances"][0][i] if results["distances"][0] else 1.0

                # RRF distances are absolute scores; lower = more similar
                # Skip if not similar enough (threshold tuned for RRF scores)
                if dist > 0.03:  # Very similar results have RRF scores < 0.03
                    continue

                existing_meta = results["metadatas"][0][i] if results["metadatas"][0] else {}

                # Extra check: if borderline similarity, require same domain
                if dist > 0.02 and site_domain and existing_meta.get("site_domain", "") != site_domain:
                    continue

                # Match found — update existing
                existing_id = doc_id
                run_count = int(existing_meta.get("run_count", "1")) + 1

                updated_meta = {
                    **existing_meta,
                    "run_count": str(run_count),
                    "updated_at": str(int(time.time())),
                }
                if len(task_pattern) > len(existing_meta.get("task_pattern", "")):
                    updated_meta["task_pattern"] = task_pattern
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
        documents=[embed_text],
        metadatas=[metadata],
    )

    return {"id": shortcut_id, "action": "created", **metadata}


def query_suggestions(task: str, top_k: int = 5) -> list[dict]:
    """Query Chroma Cloud for relevant shortcuts using hybrid search."""
    results = _hybrid_search(task, n_results=top_k)

    shortcuts = []
    for i, doc_id in enumerate(results["ids"][0]):
        dist = results["distances"][0][i] if results["distances"][0] else 1.0
        # Convert RRF distance to a 0-1 relevance score
        # RRF scores are small positive numbers; normalize for display
        relevance = max(0, min(1.0, 1.0 - (dist * 30)))  # Scale for RRF range

        if relevance < 0.2:  # Skip low relevance
            continue

        meta = results["metadatas"][0][i] if results["metadatas"][0] else {}
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
            "successAssociations": int(meta.get("success_associations", "0")),
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
            "successAssociations": int(meta.get("success_associations", "0")),
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
    """Semantic + keyword hybrid search across all shortcuts."""
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
