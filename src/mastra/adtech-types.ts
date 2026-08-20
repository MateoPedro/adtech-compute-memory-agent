export type Configuration = {
  cpu_traffic_pct: number;
  gpu_traffic_pct: number;
  cpu_replicas: number;
  gpu_replicas: number;
  batch_size: number;
  max_queue_delay_ms: number;
  execution_profile: string;
};

export type Metrics = {
  p99_latency_ms: number;
  throughput_qps: number;
  error_rate_pct: number;
  quality_score: number;
  hourly_cost_usd: number;
};

export type Constraints = {
  max_p99_latency_ms: number;
  max_error_rate_pct: number;
  min_quality_score: number;
  max_hourly_cost_usd: number;
};

export type Scenario = {
  scenario_id: string;
  title: string;
  observed_at: string;
  workload: {
    type: string;
    traffic_pattern: string;
    requests_per_second: number;
    model_name: string;
  };
  constraints: Constraints;
  current_configuration: Configuration;
  current_metrics?: Metrics;
  proposed_canary_configuration?: Configuration;
  canary_metrics?: Metrics;
  relevant_memory_ids: string[];
  expected_safe_behavior: {
    action: string;
    preferred_memory_id: string;
    superseded_memory_id?: string;
    explanation: string;
  };
};

export type OptimizationMemory = {
  memory_id: string;
  recorded_at: string;
  workload: {
    type: string;
    label: string;
    traffic_pattern: string;
    requests_per_second: number;
    model_name: string;
  };
  constraints: Constraints;
  configuration_before: Configuration;
  metrics_before: Metrics;
  action: {
    summary: string;
    configuration_after: Configuration;
    approval_required: boolean;
    canary_traffic_pct: number;
  };
  canary_result: Metrics & { duration_minutes: number; decision: string };
  outcome: string;
  rationale: string;
  search_text: string;
  tags: string[];
  supersedes_memory_id?: string;
};
