import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/store/agentStore";
import { sendNewSession } from "@/lib/agentSocket";
import { useProviders } from "@/hooks/useProviders";
import { getProviderTheme } from "@/lib/providerTheme";

export function AgentSelector() {
  const selectedAgent      = useAgentStore((s) => s.selectedAgent);
  const selectedProvider   = useAgentStore((s) => s.selectedProvider);
  const setSelectedProvider = useAgentStore((s) => s.setSelectedProvider);
  const connectionStatus   = useAgentStore((s) => s.connectionStatus);
  const { providers, loading } = useProviders();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleProviderChange = (providerId: string, available: boolean) => {
    if (!available) return;
    setSelectedProvider(providerId);
    setOpen(false);
    sendNewSession(providerId);
  };

  const dotColor =
    connectionStatus === "connected"    ? "bg-[#3fb950]" :
    connectionStatus === "connecting"   ? "bg-[#d29922]" :
    connectionStatus === "error"        ? "bg-[#f85149]" :
                                          "bg-[#8b949e]";

  const activeTheme = getProviderTheme(selectedProvider);

  return (
    <div className="flex items-center gap-2 px-4 py-2 border-b border-[#30363d]" ref={ref}>
      <span className={cn("w-2 h-2 rounded-full flex-shrink-0", dotColor)} />
      <span className="text-xs font-mono text-[#8b949e]">{selectedAgent}</span>

      <div className="relative ml-1">
        <button
          onClick={() => setOpen((o) => !o)}
          className={cn(
            "text-[10px] font-mono px-1.5 py-0.5 rounded border transition-colors",
            "flex items-center gap-1",
            activeTheme.borderClass,
            activeTheme.colorClass,
            "hover:opacity-80"
          )}
        >
          <span>{activeTheme.icon}</span>
          <span>{activeTheme.shortName}</span>
          <span className="opacity-50">▾</span>
        </button>

        {open && !loading && (
          <div className="absolute left-0 top-full mt-1 z-30 w-52 bg-[#161b22] border border-[#30363d] rounded-lg shadow-xl overflow-hidden">
            {providers.map((p) => {
              const theme   = getProviderTheme(p.id);
              const isActive = p.id === selectedProvider;
              return (
                <button
                  key={p.id}
                  onClick={() => handleProviderChange(p.id, p.available)}
                  disabled={!p.available}
                  title={p.description}
                  className={cn(
                    "w-full flex items-center justify-between px-3 py-2.5 text-left transition-colors",
                    isActive
                      ? cn("bg-[#1f6feb]/10", theme.colorClass)
                      : p.available
                      ? "text-[#e6edf3] hover:bg-[#21262d]/50"
                      : "opacity-40 cursor-not-allowed text-[#484f58]"
                  )}
                >
                  <div className="flex items-center gap-2">
                    <span className={cn("text-[14px]", theme.colorClass)}>{theme.icon}</span>
                    <div>
                      <div className="text-[12px] font-medium">{p.display_name}</div>
                      <div className="text-[10px] text-[#484f58]">
                        {p.cost_tier === "local" ? "local · free" : p.latency_tier + " latency"}
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {isActive && <span className={cn("text-[10px]", theme.colorClass)}>✓</span>}
                    {!p.available && <span className="text-[10px] text-[#484f58]">not found</span>}
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      <span
        className={cn(
          "ml-auto text-xs px-2 py-0.5 rounded-full border font-medium",
          connectionStatus === "connected"
            ? "border-[#3fb950]/40 text-[#3fb950] bg-[#3fb950]/10"
            : connectionStatus === "connecting"
            ? "border-[#d29922]/40 text-[#d29922] bg-[#d29922]/10"
            : "border-[#8b949e]/40 text-[#8b949e] bg-[#8b949e]/10"
        )}
      >
        {connectionStatus}
      </span>
    </div>
  );
}
