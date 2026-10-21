/** Aggregate, System Admin-only health data. Access decisions stay on the server. */
export interface AccessHealth {
  generated_at: string;
  rollout: {
    is_enabled: boolean;
    cohort: string | null;
    configuration_valid: boolean;
  };
  scheduler: {
    active: boolean;
    last_success_at: string | null;
    overdue: boolean;
  };
  latest_scan: {
    started_at: string;
    completed_at: string | null;
    status: "succeeded" | "partial" | "failed" | "running";
    total_accounts: number;
    checked_accounts: number;
    stale_states_corrected: number;
    mismatch_count: number;
    /** No recorded iOS/Android app version; may include portal or unused accounts. */
    unknown_client_accounts: number;
    error_count: number;
  } | null;
  open_issue_count: number;
}

function invalid(field: string): never {
  // Include only the field name, never an unexpected server payload.
  throw new Error(`Access health returned an invalid ${field}.`);
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return invalid(field);
  return value as Record<string, unknown>;
}

function boolean(value: unknown, field: string): boolean {
  return typeof value === "boolean" ? value : invalid(field);
}

function count(value: unknown, field: string): number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : invalid(field);
}

function date(value: unknown, field: string): string {
  return typeof value === "string" && value.trim() !== "" && Number.isFinite(Date.parse(value))
    ? value
    : invalid(field);
}

function optionalDate(value: unknown, field: string): string | null {
  return value === null ? null : date(value, field);
}

/** Missing or malformed counts must never turn into a reassuring zero. */
export function parseAccessHealth(value: unknown): AccessHealth {
  const raw = object(value, "response");
  const rollout = object(raw.rollout, "rollout");
  const scheduler = object(raw.scheduler, "scheduler");
  const cohort = rollout.cohort;
  if (cohort !== null && (typeof cohort !== "string" || !cohort.trim())) invalid("rollout cohort");

  let scan: AccessHealth["latest_scan"] = null;
  if (raw.latest_scan !== null) {
    const latest = object(raw.latest_scan, "latest scan");
    const status = latest.status;
    if (status !== "succeeded" && status !== "partial" && status !== "failed" && status !== "running") {
      invalid("scan status");
    }
    scan = {
      started_at: date(latest.started_at, "scan start"),
      completed_at: optionalDate(latest.completed_at, "scan completion"),
      status,
      total_accounts: count(latest.total_accounts, "total accounts"),
      checked_accounts: count(latest.checked_accounts, "checked accounts"),
      stale_states_corrected: count(latest.stale_states_corrected, "corrected states"),
      mismatch_count: count(latest.mismatch_count, "mismatches"),
      unknown_client_accounts: count(latest.unknown_client_accounts, "unknown client accounts"),
      error_count: count(latest.error_count, "scan errors"),
    };
    if (scan.checked_accounts > scan.total_accounts) invalid("scan coverage");
    if (scan.completed_at && Date.parse(scan.completed_at) < Date.parse(scan.started_at)) {
      invalid("scan completion");
    }
  }

  return {
    generated_at: date(raw.generated_at, "generation time"),
    rollout: {
      is_enabled: boolean(rollout.is_enabled, "rollout state"),
      cohort: cohort as string | null,
      configuration_valid: boolean(rollout.configuration_valid, "rollout configuration"),
    },
    scheduler: {
      active: boolean(scheduler.active, "scheduler state"),
      last_success_at: optionalDate(scheduler.last_success_at, "last successful scan"),
      overdue: boolean(scheduler.overdue, "scheduler freshness"),
    },
    latest_scan: scan,
    open_issue_count: count(raw.open_issue_count, "open issues"),
  };
}

export interface AccessHealthSummary {
  tone: "healthy" | "attention" | "critical" | "pending";
  label: string;
  description: string;
}

/** Presentation of monitor results only; never used to grant or deny access. */
export function accessHealthSummary(health: AccessHealth): AccessHealthSummary {
  const scan = health.latest_scan;
  if (!health.rollout.configuration_valid) {
    return { tone: "critical", label: "Configuration issue", description: "The access rollout configuration needs review." };
  }
  if (!health.rollout.is_enabled) {
    return { tone: "attention", label: "Rollout paused", description: "Vineyard access rollout is disabled. Full user coverage requires an enabled rollout." };
  }
  if (!health.scheduler.active) {
    return { tone: "attention", label: "Automation paused", description: "Scheduled access checks are inactive. The figures below are from the latest recorded scan." };
  }
  if (health.scheduler.overdue) {
    return { tone: "critical", label: "Scan overdue", description: "A successful scheduled access check is overdue. Current coverage is unconfirmed." };
  }
  if (scan?.status === "failed" || (scan && scan.error_count > 0)) {
    return { tone: "critical", label: "Scan needs review", description: "The latest access check recorded errors. Its results do not confirm complete coverage." };
  }
  if ((scan && scan.mismatch_count > 0) || health.open_issue_count > 0) {
    return { tone: "attention", label: "Needs attention", description: "Access mismatches or open monitoring issues need review." };
  }
  if (scan?.status === "running") {
    return { tone: "pending", label: "Scan in progress", description: "The current scan is still checking accounts. Coverage will update when it completes." };
  }
  if (!scan || !health.scheduler.last_success_at) {
    return { tone: "pending", label: "Awaiting full scan", description: "A completed successful access check has not yet been confirmed." };
  }
  if (scan.status !== "succeeded" || !scan.completed_at || scan.checked_accounts !== scan.total_accounts) {
    return { tone: "attention", label: "Scan incomplete", description: "The latest scan did not confirm every account. Review the coverage below." };
  }
  if (health.rollout.cohort !== "all") {
    return { tone: "attention", label: "Limited rollout", description: "Vineyard access is enabled for a limited cohort. The rollout does not yet cover all users." };
  }
  // Missing mobile telemetry is a separate coverage signal, not a failed access check.
  return { tone: "healthy", label: "Automation healthy", description: "The latest scan checked every account and found no access mismatches or open monitoring issues." };
}
