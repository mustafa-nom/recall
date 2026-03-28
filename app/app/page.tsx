"use client";

import { useState } from "react";
import AgentTab from "@/components/AgentTab";
import HubTab from "@/components/HubTab";
import { RecallMark } from "@/components/RecallMark";

type Tab = "agent" | "hub";

export default function Home() {
  const [activeTab, setActiveTab] = useState<Tab>("agent");

  return (
    <div className="relative z-10 flex flex-col h-screen overflow-hidden font-sans">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 border-b border-border bg-background/80 backdrop-blur-sm">
        <div className="flex items-baseline gap-2.5 min-w-0">
          <RecallMark className="h-7 w-auto text-accent self-center shrink-0" aria-hidden />
          <span className="text-[15px] font-bold tracking-wide uppercase text-foreground shrink-0">
            Recall
          </span>
          <span className="text-[11px] text-text-muted font-medium hidden sm:inline truncate">
            Self-Improving Browser Agent
          </span>
        </div>

        <nav className="flex items-center gap-1">
          <button
            onClick={() => setActiveTab("agent")}
            className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${
              activeTab === "agent"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:text-foreground hover:bg-surface-raised"
            }`}
          >
            Agent
          </button>
          <button
            onClick={() => setActiveTab("hub")}
            className={`px-3.5 py-1.5 text-[13px] font-semibold rounded-md transition-colors ${
              activeTab === "hub"
                ? "bg-accent/10 text-accent"
                : "text-text-muted hover:text-foreground hover:bg-surface-raised"
            }`}
          >
            Hub
          </button>
        </nav>
      </header>

      {/* Tab Content */}
      <main className="flex-1 overflow-hidden">
        {activeTab === "agent" && <AgentTab />}
        {activeTab === "hub" && <HubTab />}
      </main>
    </div>
  );
}
