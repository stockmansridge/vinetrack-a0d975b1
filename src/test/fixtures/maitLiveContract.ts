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
  module_id: 'weather', columns: [{ index: 1, channel_key: 'Rain', channel_number: 8, label: 'Rain', unit: 'mm' }],
  latest: { DateTime: '2026-10-24T08:00:00', Rain: '3' }, record_count: 1, partial: false,
};
export const maitSyncFixture = {
  success: true, module_id: 'controller', partial: true, received: 10, staged: 8, committed: 4,
  existing: 2, needs_mapping: 1, needs_review: 2, possible_changed_event: 1, results: [],
};