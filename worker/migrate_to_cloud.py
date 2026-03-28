"""
Migration script: Local ChromaDB -> Chroma Cloud

Reads shortcuts from the local PersistentClient store and re-inserts them
into Chroma Cloud with the new hybrid search schema (Qwen dense + Splade sparse).

Usage:
    python migrate_to_cloud.py
"""

import os
import sys

from dotenv import load_dotenv

load_dotenv()

import chromadb

# -- Source: local persistent store --
LOCAL_PERSIST_DIR = os.path.join(os.path.dirname(__file__), "data", "chroma")
LOCAL_COLLECTION = "recall_shortcuts"


def get_local_data() -> list[dict]:
    """Read all shortcuts from the local ChromaDB."""
    if not os.path.exists(LOCAL_PERSIST_DIR):
        print(f"No local data directory found at {LOCAL_PERSIST_DIR}")
        return []

    client = chromadb.PersistentClient(path=LOCAL_PERSIST_DIR)
    try:
        collection = client.get_collection(name=LOCAL_COLLECTION)
    except Exception:
        print(f"No local collection '{LOCAL_COLLECTION}' found.")
        return []

    count = collection.count()
    if count == 0:
        print("Local collection is empty.")
        return []

    results = collection.get()
    records = []
    for i, doc_id in enumerate(results["ids"]):
        records.append({
            "id": doc_id,
            "document": results["documents"][i] if results["documents"] else "",
            "metadata": results["metadatas"][i] if results["metadatas"] else {},
        })

    print(f"Found {len(records)} local shortcuts to migrate.")
    return records


def migrate():
    """Migrate local shortcuts to Chroma Cloud."""
    records = get_local_data()

    if not records:
        print("Nothing to migrate.")
        return

    # Import cloud store (uses the new Chroma Cloud client)
    from chroma_store import _get_collection

    collection = _get_collection()
    existing_count = collection.count()
    print(f"Chroma Cloud collection has {existing_count} existing records.")

    migrated = 0
    skipped = 0

    for record in records:
        doc_id = record["id"]
        meta = record["metadata"]
        document = record["document"]

        # Check if already exists in cloud
        try:
            existing = collection.get(ids=[doc_id])
            if existing["ids"]:
                print(f"  Skip {doc_id} (already in cloud)")
                skipped += 1
                continue
        except Exception:
            pass

        # Add to cloud (embeddings generated automatically by schema)
        try:
            collection.add(
                ids=[doc_id],
                documents=[document] if document else [f"{meta.get('task_pattern', '')} {meta.get('suggestion', '')} {meta.get('how', '')}"],
                metadatas=[meta],
            )
            migrated += 1
            print(f"  Migrated {doc_id}: {meta.get('suggestion', '')[:50]}")
        except Exception as e:
            print(f"  Error migrating {doc_id}: {e}")

    print(f"\nMigration complete: {migrated} migrated, {skipped} skipped.")


if __name__ == "__main__":
    migrate()
