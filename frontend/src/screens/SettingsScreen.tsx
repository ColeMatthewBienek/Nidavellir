import { cn } from "@/lib/utils";
import { TopBar } from "../components/shared/TopBar";
import { Btn } from "../components/shared/Btn";
import { useProviders } from "@/hooks/useProviders";
import { getProviderTheme, ROLE_THEME } from "@/lib/providerTheme";
import type { ProviderDangerousness } from "@/lib/types";
import { useAgentStore } from "@/store/agentStore";

export function SettingsScreen() {
  const { providers } = useProviders();
  const setProviders = useAgentStore((state) => state.setProviders);

  const updateDangerousness = (providerId: string, dangerousness: ProviderDangerousness) => {
    fetch(`http://localhost:7430/api/agents/provider-policies/${providerId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ dangerousness }),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`provider_policy_${response.status}`);
        return fetch("http://localhost:7430/api/agents/providers");
      })
      .then(async (response) => response.json() as Promise<{ providers: typeof providers }>)
      .then((data) => setProviders(data.providers))
      .catch((err) => console.warn("provider policy update failed", err));
  };

  return (
    <div style={{ display: "flex", flex: 1, flexDirection: "column", overflow: "hidden" }}>
      <TopBar title="Settings"/>
      <div style={{ flex: 1, overflow: "auto", padding: 20, maxWidth: 600 }}>
        {[
          { section: "Models", fields: [
            { label: "Default model",  type: "select",   opts: ["claude-opus-4","claude-sonnet-4","codex-mini","gemini-2.5-pro"] },
            { label: "Fallback model", type: "select",   opts: ["claude-haiku-4-5","gpt-4o-mini"] },
          ]},
          { section: "Agent Pool", fields: [
            { label: "Max concurrent agents",   type: "number",   val: "4"   },
            { label: "Agent timeout (seconds)", type: "number",   val: "300" },
          ]},
          { section: "API Keys", fields: [
            { label: "Anthropic API Key", type: "password", val: "sk-ant-•••••••••••••••" },
            { label: "OpenAI API Key",    type: "password", val: "sk-•••••••••••••••" },
          ]},
        ].map((grp) => (
          <div key={grp.section} style={{ marginBottom: 24 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: "var(--t1)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 12 }}>{grp.section}</div>
            <div style={{ background: "var(--bg1)", border: "1px solid var(--bd)", borderRadius: 8, overflow: "hidden" }}>
              {grp.fields.map((f, i) => (
                <div key={f.label} style={{
                  display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px",
                  borderBottom: i < grp.fields.length - 1 ? "1px solid var(--bd)" : "none",
                }}>
                  <label style={{ fontSize: 13, color: "var(--t0)" }}>{f.label}</label>
                  {f.type === "select" ? (
                    <select style={{ background: "var(--bg2)", border: "1px solid var(--bd)", borderRadius: 5, padding: "5px 10px", fontSize: 12, color: "var(--t0)", outline: "none", cursor: "pointer" }}>
                      {(f as { opts: string[] }).opts.map((o) => <option key={o}>{o}</option>)}
                    </select>
                  ) : (
                    <input type={f.type} defaultValue={(f as { val: string }).val} style={{ background: "var(--bg2)", border: "1px solid var(--bd)", borderRadius: 5, padding: "5px 10px", fontSize: 12, color: "var(--t0)", outline: "none", width: 220, fontFamily: "var(--mono)" }}/>
                  )}
                </div>
              ))}
            </div>
          </div>
        ))}

        {/* Providers section */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: "var(--t1)", textTransform: "uppercase", letterSpacing: "0.7px", marginBottom: 12, paddingBottom: 8, borderBottom: "1px solid var(--bd)" }}>
            Providers
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            {providers.map((p) => {
              const theme = getProviderTheme(p.id);
              return (
                <div
                  key={p.id}
                  style={{
                    borderRadius: 8,
                    border: "1px solid var(--bd)",
                    padding: 14,
                    background: "var(--bg0)",
                    opacity: p.available ? 1 : 0.5,
                  }}
                >
                  {/* Header row */}
                  <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 8 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <span className={theme.colorClass} style={{ fontSize: 16 }}>{theme.icon}</span>
                      <span style={{ fontSize: 13, fontWeight: 500, color: "var(--t0)" }}>{p.display_name}</span>
                      <span className={cn(
                        "text-[10px] font-mono px-1.5 py-0.5 rounded border",
                        p.available
                          ? "border-[#3fb950]/30 text-[#3fb950] bg-[#3fb950]/5"
                          : "border-[#484f58]/30 text-[#484f58]"
                      )}>
                        {p.available ? "available" : "not found"}
                      </span>
                    </div>
                    <div style={{ display: "flex", gap: 6 }}>
                      <span className="text-[10px] font-mono text-[#484f58] px-1.5 py-0.5 rounded border border-[#21262d]">
                        {p.cost_tier}
                      </span>
                      <span className="text-[10px] font-mono text-[#484f58] px-1.5 py-0.5 rounded border border-[#21262d]">
                        {p.latency_tier} latency
                      </span>
                    </div>
                  </div>

                  {/* Description */}
                  <p style={{ fontSize: 11, color: "var(--t1)", marginBottom: 10, lineHeight: 1.5 }}>{p.description}</p>

                  <div style={{
                    border: "1px solid var(--bd)",
                    borderRadius: 6,
                    padding: 10,
                    background: "var(--bg1)",
                    marginBottom: 10,
                    display: "grid",
                    gridTemplateColumns: "minmax(0, 1fr) auto",
                    gap: 10,
                    alignItems: "center",
                  }}>
                    <div>
                      <div style={{ fontSize: 11, fontWeight: 700, color: "var(--t0)" }}>Dangerousness</div>
                      <div style={{ fontSize: 10, color: "var(--t1)", lineHeight: 1.45, marginTop: 3 }}>
                        {p.dangerousness_warning || (p.effective_dangerousness === "free_rein"
                          ? "Provider-native permissions are bypassed. Use only when the workspace is trusted."
                          : "Nidavellir constrains provider-native tools according to this mode.")}
                      </div>
                    </div>
                    <select
                      aria-label={`${p.display_name} dangerousness`}
                      value={p.dangerousness ?? p.default_dangerousness ?? "restricted"}
                      onChange={(event) => updateDangerousness(p.id, event.target.value as ProviderDangerousness)}
                      style={{ background: "var(--bg2)", border: "1px solid var(--bd)", borderRadius: 5, padding: "5px 8px", fontSize: 12, color: "var(--t0)", outline: "none", cursor: "pointer" }}
                    >
                      <option value="restricted">Restricted</option>
                      <option value="ask">Ask</option>
                      <option value="trusted">Trusted</option>
                      <option value="free_rein">Free rein</option>
                    </select>
                  </div>

                  {/* Roles */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", marginBottom: 10 }}>
                    <span style={{ fontSize: 10, color: "var(--t1)", marginRight: 2 }}>roles:</span>
                    {p.roles.map((role) => {
                      const rt = ROLE_THEME[role];
                      return (
                        <span
                          key={role}
                          className={cn("text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#21262d]", rt?.colorClass ?? "text-[#8b949e]")}
                        >
                          {rt?.label ?? role}
                        </span>
                      );
                    })}
                  </div>

                  {/* Capability chips */}
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                    {[
                      { flag: p.supports_session_resume,     label: "resume" },
                      { flag: p.supports_image_input,        label: "vision" },
                      { flag: p.supports_file_context,       label: "files" },
                      { flag: p.supports_bash_execution,     label: "bash" },
                      { flag: p.supports_worktree_isolation, label: "worktree" },
                      { flag: p.emits_tool_use_blocks,       label: "tool-use" },
                      { flag: Boolean(p.supports_mediated_tool_approval), label: "mediated" },
                      { flag: p.streams_incrementally,       label: "streaming" },
                      { flag: !p.requires_network,           label: "offline" },
                    ].map(({ flag, label }) => (
                      <span
                        key={label}
                        className={cn(
                          "text-[10px] font-mono px-1.5 py-0.5 rounded border border-[#21262d]",
                          flag ? "text-[#c9d1d9]" : "text-[#484f58] opacity-40"
                        )}
                      >
                        {flag ? "✓" : "✗"} {label}
                      </span>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <Btn primary>Save Changes</Btn>
      </div>
    </div>
  );
}
