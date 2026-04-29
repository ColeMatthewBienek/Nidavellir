// ── Provider types ────────────────────────────────────────────────────────

export type ProviderRole =
  | "planner"
  | "em_reviewer"
  | "executor"
  | "chat"
  | "qa_reviewer";

export type CostTier    = "local" | "subscription" | "api_metered" | "free";
export type LatencyTier = "low" | "medium" | "high";
export type OutputFormat = "ansi_rich" | "ansi_simple" | "markdown" | "plain";

export interface ProviderInfo {
  id:           string;
  display_name: string;
  description:  string;
  available:    boolean;
  roles:        ProviderRole[];

  // Session
  supports_session_resume:     boolean;
  supports_persistent_context: boolean;

  // Input
  supports_multiline_input: boolean;
  supports_file_context:    boolean;
  supports_image_input:     boolean;
  supports_live_steering:   boolean;
  supports_queued_steering: boolean;
  supports_redirect_steering: boolean;
  steering_label:           string;

  // Output / streaming
  supports_interrupt:     boolean;
  streams_incrementally:  boolean;
  emits_tool_use_blocks:  boolean;
  output_format:          OutputFormat;

  // Execution
  supports_bash_execution:     boolean;
  supports_file_write:         boolean;
  supports_worktree_isolation: boolean;

  // Cost / resources
  cost_tier:        CostTier;
  requires_network: boolean;
  latency_tier:     LatencyTier;

  // Pool
  supports_parallel_slots: boolean;
  max_concurrent_slots:    number | null;
}

// ── Agent model types ─────────────────────────────────────────────────────────

export interface AgentModelDef {
  id:           string;   // globally unique: "{provider_id}:{model_id}"
  provider_id:  string;   // "claude" | "codex" | "ollama"
  model_id:     string;   // value passed to the CLI --model flag
  display_name: string;
  description:  string;
  cost_tier:    CostTier;
  available:    boolean;
}
