/**
 * Generic, provider-keyed import guidance shown in the import wizard.
 *
 * This is presentation-only fallback content used when the backend provider
 * registry does not (yet) return `import_instructions` / `help_steps`.
 * It must never contain vineyard-, valve-, variety- or customer-specific data.
 */
export interface ProviderHelp {
  title: string;
  steps: string[];
  formatNote?: string;
  duplicateNote?: string;
  uploadNote?: string;
}

const PROVIDER_HELP: Record<string, ProviderHelp> = {
  galcon_gsi: {
    title: "How to export irrigation history from Galcon GSI",
    steps: [
      "Sign in to the Galcon GSI website.",
      "Open Your Unit.",
      "Select Irrigation from the top-middle navigation.",
      "Open the Irrigation History tab.",
      "Select the required date range.",
      "Select Export.",
      "Upload the downloaded file to VineTrack.",
    ],
    formatNote:
      "VineTrack currently accepts the Galcon irrigation-history export in XLSX or CSV format.",
    duplicateNote:
      "Choose a date range that may overlap a previous export if needed. VineTrack checks for duplicates and will not import the same irrigation event twice.",
  },
};

/**
 * Resolve help content for a provider. Registry-supplied instructions always win;
 * the local map is only a fallback keyed by provider id.
 */
export function resolveProviderHelp(
  providerId: string | null | undefined,
  registry?: {
    display_name?: string | null;
    import_instructions?: unknown;
    help_steps?: unknown;
  } | null,
): ProviderHelp | null {
  const fromRegistry = normaliseRegistryHelp(registry);
  if (fromRegistry) return fromRegistry;
  if (!providerId) return null;
  return PROVIDER_HELP[providerId] ?? null;
}

function normaliseRegistryHelp(
  registry?: {
    display_name?: string | null;
    import_instructions?: unknown;
    help_steps?: unknown;
  } | null,
): ProviderHelp | null {
  if (!registry) return null;
  const raw = (registry.import_instructions ?? registry.help_steps) as unknown;
  if (!raw) return null;

  if (Array.isArray(raw)) {
    const steps = raw.filter((s): s is string => typeof s === "string");
    if (!steps.length) return null;
    return {
      title: `How to export irrigation history from ${registry.display_name ?? "your controller"}`,
      steps,
    };
  }

  if (typeof raw === "object") {
    const obj = raw as Record<string, unknown>;
    const steps = Array.isArray(obj.steps)
      ? obj.steps.filter((s): s is string => typeof s === "string")
      : [];
    if (!steps.length) return null;
    return {
      title:
        typeof obj.title === "string"
          ? obj.title
          : `How to export irrigation history from ${registry.display_name ?? "your controller"}`,
      steps,
      formatNote: typeof obj.format_note === "string" ? obj.format_note : undefined,
      duplicateNote: typeof obj.duplicate_note === "string" ? obj.duplicate_note : undefined,
      uploadNote: typeof obj.upload_note === "string" ? obj.upload_note : undefined,
    };
  }

  return null;
}
