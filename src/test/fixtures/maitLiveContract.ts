// Exact live MAIT response envelopes; values are test-only, never customer data.
export function maitConfigurationFixture() {
  return {
    vineyard_id: 'v', access: { manage: true, view: true },
    connection: { configured: true, username: 'user', has_password: true, network_id: 'network', network_name: 'Farm network', timezone: 'Australia/Sydney', is_active: true, rainfall_publish_enabled: false, last_tested_at: null, last_test_status: 'success', updated_at: null },
    modules: [
      { id: 'weather-row', module_id: 'weather', module_name: 'Weather', module_role: 'weather', irrigation_system_id: null, is_active: true, metadata: {}, updated_at: null },
      { id: 'controller-row', module_id: 'controller', module_name: 'Pump', module_role: 'irrigation_controller', irrigation_system_id: 'system', is_active: true, metadata: {}, updated_at: null },
    ],
    weather_mappings: [] as Record<string, any>[], sync: [],
  };
}
export const maitInspectFixture = {
  module_id: 'weather', columns: [{ index: 0, channel_key: 'DateTime', channel_number: null, label: 'Date time', unit: '' }, { index: 1, channel_key: 'Rain', channel_number: 8, label: 'Rain', unit: 'mm' }],
  latest: { DateTime: '2026-10-24T08:00:00', Rain: '3' }, record_count: 1, partial: false,
};
export const maitSyncFixture = {
  success: false, module_id: 'controller', partial: true, received: 10, staged: 8, committed: 4,
  existing: 2, needs_mapping: 1, needs_review: 2, possible_changed_event: 1, results: [],
};
export const maitIntegrationStatusFixture = { id: 'integration-row', provider: 'mait_intelliweb', station_id: 'weather', station_name: 'Weather station', is_active: true };
export const maitSyncStatusFixture = { sync: [
  { module_id: 'controller', sync_kind: 'irrigation_usage', last_attempt_at: '2026-10-24T07:00:00Z', last_success_at: '2026-10-23T07:00:00Z', records_received: 10, records_created: 4, records_existing: 2, records_needing_mapping: 1, records_needing_review: 3, incomplete_range: true },
] };