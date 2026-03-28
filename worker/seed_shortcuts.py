"""
Pre-seed ChromaDB with shortcuts for demo example tasks.

Usage:
    python seed_shortcuts.py          # Seed shortcuts (skip duplicates)
    python seed_shortcuts.py --clear  # Clear collection first, then seed
"""

import sys
import os

# Ensure worker directory is on the path
sys.path.insert(0, os.path.dirname(__file__))

from dotenv import load_dotenv

load_dotenv()

from chroma_store import store_suggestion, _get_collection

DEMO_SHORTCUTS = [
    {
        "task_pattern": "search Hacker News for posts or discussions about a topic",
        "suggestion": "Use hn.algolia.com instead of news.ycombinator.com for search",
        "how": (
            "Navigate to https://hn.algolia.com, click the search input at the top, "
            "and type your query. Results appear instantly as you type -- no need to "
            "press Enter. This is much faster than browsing news.ycombinator.com manually."
        ),
        "when": "Any task involving finding posts, comments, or discussions on Hacker News",
        "category": "speed",
        "site_domain": "hn.algolia.com",
        "estimated_impact": "high",
    },
    {
        "task_pattern": "compare flight prices or search for flights",
        "suggestion": "Navigate directly to google.com/travel/flights and use the search form",
        "how": (
            "Go to https://www.google.com/travel/flights. The search form has two main fields: "
            "'Where from?' on the LEFT and 'Where to?' on the RIGHT. Click the 'Where to?' "
            "field (right side, around x=580, y=370), type the destination city, then select "
            "the correct suggestion from the autocomplete dropdown. Do NOT press Enter blindly — "
            "wait for the dropdown and click the correct city. The origin defaults to your location."
        ),
        "when": "Any task involving flight search, price comparison, or travel booking",
        "category": "accuracy",
        "site_domain": "google.com/travel",
        "estimated_impact": "high",
    },
    {
        "task_pattern": "find a restaurant or place on Google Maps",
        "suggestion": "Navigate to google.com/maps and use the search bar at top-left",
        "how": (
            "Go to https://www.google.com/maps. Click the search bar at the top-left "
            "of the page (around x=250, y=40). Type the search query (e.g., 'Italian "
            "restaurant Manhattan'), then press Enter. Results will appear as a list on "
            "the left side with ratings and reviews. The first result with the highest "
            "rating is usually the best match."
        ),
        "when": "Any task involving finding restaurants, businesses, or locations",
        "category": "speed",
        "site_domain": "maps.google.com",
        "estimated_impact": "high",
    },
    {
        "task_pattern": "search Wikipedia for information about a topic",
        "suggestion": "Navigate directly to en.wikipedia.org and use the search bar",
        "how": (
            "Go to https://en.wikipedia.org, click the search input field in the "
            "center of the page, type the search query, then press Enter. The search "
            "bar is a standard HTML input that reliably submits on Enter."
        ),
        "when": "Any task that involves looking up factual information or encyclopedic content",
        "category": "speed",
        "site_domain": "en.wikipedia.org",
        "estimated_impact": "high",
    },
    {
        "task_pattern": "find the most viewed or best result on a search page",
        "suggestion": "Click the first non-ad result without scrolling",
        "how": (
            "On any search results page (YouTube, Google, DuckDuckGo, etc.), "
            "the first non-sponsored result is almost always the best match. "
            "Skip any results with 'Ad', 'Sponsored', or 'Promoted' badges. "
            "Do NOT scroll to compare — platforms rank by relevance. Click "
            "the first organic result immediately."
        ),
        "when": "Any task asking for top, best, or most viewed result on a search/listing page",
        "category": "accuracy",
        "site_domain": "",
        "estimated_impact": "high",
    },
]


def seed(clear: bool = False):
    if clear:
        collection = _get_collection()
        # Delete all existing documents
        all_ids = collection.get()["ids"]
        if all_ids:
            collection.delete(ids=all_ids)
            print(f"Cleared {len(all_ids)} existing shortcuts")

    for shortcut in DEMO_SHORTCUTS:
        result = store_suggestion(**shortcut)
        action = result.get("action", "unknown")
        sc_id = result.get("id", "?")
        print(f"  [{action}] {sc_id} — {shortcut['suggestion'][:60]}")

    print(f"\nDone. {len(DEMO_SHORTCUTS)} demo shortcuts processed.")


if __name__ == "__main__":
    clear_flag = "--clear" in sys.argv
    seed(clear=clear_flag)
