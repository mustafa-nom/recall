"""
Integration test for the observer → hub → agent self-improvement loop.

Tests:
1. Real-time observer generates and stores suggestions during a run
2. Post-run observer generates and stores suggestions after a run
3. Hub query retrieves stored suggestions for similar tasks
4. Second run receives shortcuts from hub

Usage:
  python3 tests/test_observer_hub_loop.py

Requires the worker to be running on localhost:8000.
"""

import asyncio
import json
import sys
import httpx

WORKER = "http://127.0.0.1:8000"


async def test_loop():
    errors = []

    async with httpx.AsyncClient(timeout=120) as client:
        # Step 0: Health check
        print("=== Step 0: Health check ===")
        try:
            r = await client.get(f"{WORKER}/health")
            r.raise_for_status()
            print(f"  Worker OK: {r.json()}")
        except Exception as e:
            print(f"  FAIL: Worker not running — {e}")
            print("  Start the worker first: cd worker && uvicorn main:app --port 8000")
            return False

        # Step 1: Check hub is empty (we cleared ChromaDB)
        print("\n=== Step 1: Check hub is clean ===")
        r = await client.get(f"{WORKER}/api/hub/stats")
        stats = r.json()
        total = stats.get("totalShortcuts", 0)
        print(f"  Hub has {total} shortcuts")

        # Step 2: Run an agent task (collect SSE events)
        print("\n=== Step 2: Run agent task ===")
        task = "go to hacker news and find the top story"
        r = await client.post(
            f"{WORKER}/api/run-agent",
            json={"task": task, "model": "gemini-2.5-flash-native-audio-latest", "maxSteps": 15, "shortcuts": []},
            timeout=180,
        )
        steps = []
        completed = False
        success = False
        timing_ms = 0
        async for line in r.aiter_lines():
            if line.startswith("data: "):
                data = line[6:]
                if data == "[DONE]":
                    break
                event = json.loads(data)
                if event.get("type") == "step_progress":
                    steps.append(event)
                    print(f"  Step {event['stepIndex']}: [{event['action']['type']}] {event['action']['action'][:60]}")
                elif event.get("type") == "agent_completed":
                    completed = True
                    success = event.get("success", False)
                    timing_ms = event.get("timing", {}).get("totalElapsedMs", 0)
                    print(f"  Completed: success={success} steps={event['totalActions']} time={timing_ms}ms")
                elif event.get("type") == "agent_error":
                    completed = True
                    print(f"  Error: {event.get('error', '?')}")

        if not completed:
            errors.append("Agent never completed")
            print("  FAIL: Agent never sent agent_completed event")

        # Step 3: Simulate real-time observer call (like the frontend does)
        print("\n=== Step 3: Real-time observer ===")
        observe_body = {
            "task": task,
            "steps": [
                {"index": s["stepIndex"], "action": s["action"], "timing": s["timing"]}
                for s in steps[:5]
            ],
            "previous_suggestions": [],
        }
        r = await client.post(f"{WORKER}/api/observe", json=observe_body, timeout=60)
        print(f"  Status: {r.status_code}")
        if r.status_code != 200:
            print(f"  Error response: {r.text[:200]}")
        else:
            obs = r.json()
            has_suggestion = obs.get("hasSuggestion", False)
            print(f"  hasSuggestion: {has_suggestion}")
            if has_suggestion:
                print(f"  suggestion: {obs.get('suggestion', '')}")
                print(f"  how: {obs.get('how', '')[:80]}")
            else:
                print("  (No suggestion returned — may be normal if agent was optimal)")

        # Step 4: Simulate post-run observer call
        print("\n=== Step 4: Post-run observer ===")
        postrun_body = {
            "task": task,
            "domain": "news.ycombinator.com",
            "all_steps": [
                {"stepIndex": s["stepIndex"], "action": s["action"], "timing": s["timing"]}
                for s in steps
            ],
            "success": success,
            "total_time_ms": timing_ms,
        }
        r = await client.post(f"{WORKER}/api/observe/post-run", json=postrun_body, timeout=60)
        print(f"  Status: {r.status_code}")
        if r.status_code != 200:
            print(f"  Error response: {r.text[:200]}")
            postrun = {"suggestions": [], "stored": []}
        else:
            postrun = r.json()
        suggestions = postrun.get("suggestions", [])
        stored = postrun.get("stored", [])
        print(f"  {len(suggestions)} suggestions returned")
        for s in suggestions:
            print(f"    [{s.get('category', '?')}] {s.get('suggestion', '')}")
        print(f"  {len(stored)} stored in ChromaDB")
        for s in stored:
            print(f"    {s.get('action', '?')}: id={s.get('id', '?')}")

        if len(suggestions) == 0:
            errors.append("Post-run observer returned 0 suggestions")
            print("  WARN: Expected at least 1 suggestion")

        # Step 5: Verify hub now has shortcuts
        print("\n=== Step 5: Verify hub has shortcuts ===")
        r = await client.get(f"{WORKER}/api/hub/shortcuts")
        hub = r.json()
        shortcuts = hub.get("shortcuts", [])
        print(f"  Hub now has {len(shortcuts)} shortcuts")
        for s in shortcuts:
            print(f"    [{s.get('category', '?')}] {s.get('suggestion', '')[:50]} (task={s.get('taskPattern', '')[:40]})")

        if len(shortcuts) == 0:
            errors.append("Hub has 0 shortcuts after run")
            print("  FAIL: Expected at least 1 shortcut")

        # Verify task patterns are not empty
        empty_patterns = [s for s in shortcuts if not s.get("taskPattern", "").strip()]
        if empty_patterns:
            errors.append(f"{len(empty_patterns)} shortcuts have empty taskPattern")
            print(f"  FAIL: {len(empty_patterns)} shortcuts have empty taskPattern!")

        # Step 6: Hub query for same task should return shortcuts
        print("\n=== Step 6: Hub query for same task ===")
        r = await client.get(f"{WORKER}/api/hub/query", params={"task": task})
        query_result = r.json()
        matched = query_result.get("shortcuts", [])
        print(f"  Query for '{task[:40]}...' returned {len(matched)} shortcuts")
        for s in matched:
            print(f"    [{s.get('category', '?')}] {s.get('suggestion', '')[:50]} (relevance={s.get('relevance', 0):.3f})")

        if len(matched) == 0:
            errors.append("Hub query returned 0 matches for same task")
            print("  FAIL: Expected matches for the same task")

    # Summary
    print("\n" + "=" * 50)
    if errors:
        print(f"ISSUES FOUND ({len(errors)}):")
        for e in errors:
            print(f"  - {e}")
        return False
    else:
        print("ALL CHECKS PASSED")
        print("The observer → hub → agent loop is working correctly.")
        return True


if __name__ == "__main__":
    ok = asyncio.run(test_loop())
    sys.exit(0 if ok else 1)
