import { maitConfigurationFixture, maitIntegrationStatusFixture } from './fixtures/maitLiveContract';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { MaitWeatherCard } from '@/components/mait/MaitWeatherCard';
import { maitConfiguration, maitConversion, maitWindSuggestion, maitSupplementary, MAIT_SENSOR_METRICS } from '@/lib/maitIntelliwebQuery';

const mocks = vi.hoisted(() => ({
  rpc: vi.fn(),
  manage: true,
  connected: true,
  config: {} as ReturnType<typeof maitConfigurationFixture>,
  supplementaryStatus: 200,
}));
vi.mock('@/integrations/ios-supabase/client', () => ({ supabase: { rpc: mocks.rpc, auth: { getSession: async () => ({ data: { session: { access_token: 'fixture' } } }) } }, IOS_SUPABASE_URL: 'https://example.test', IOS_SUPABASE_ANON_KEY: 'public' }));
vi.mock('@/lib/vineyardSettingsQuery', () => ({ fetchVineyard: async () => ({ timezone: 'Australia/Sydney' }) }));

function mount(ui: React.ReactNode) {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } })}><MemoryRouter>{ui}</MemoryRouter></QueryClientProvider>);
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

// Exact first-customer weather station channels, including the "°" wind direction unit.
const windInspectFixture = {
  module_id: 'weather',
  columns: [
    { index: 0, channel_key: 'DateTime', channel_number: null, label: 'Date time', unit: '' },
    { index: 1, channel_key: 'WDir', channel_number: 5, label: 'Wind Direction', unit: '°' },
    { index: 2, channel_key: 'WSMin', channel_number: 6, label: 'Wind Speed Min', unit: 'km/h' },
    { index: 3, channel_key: 'WSAvg', channel_number: 7, label: 'Wind Speed Avg', unit: 'km/h' },
    { index: 4, channel_key: 'WSMax', channel_number: 8, label: 'Wind Speed Max', unit: 'km/h' },
  ],
  latest: { DateTime: '2026-10-26T08:00:00', WDir: '215', WSMin: '3', WSAvg: '9', WSMax: '14' },
  record_count: 1, partial: false,
};
const soilInspectFixture = {
  module_id: 'soil',
  columns: [
    { index: 0, channel_key: 'DateTime', channel_number: null, label: 'Date time', unit: '' },
    { index: 1, channel_key: 'SM1', channel_number: 3, label: 'Soil Moisture', unit: '%' },
  ],
  latest: { DateTime: '2026-10-26T08:00:00', SM1: '24.5' },
  record_count: 1, partial: false,
};
const supplementaryFixture = {
  success: true, partial: false,
  modules: [
    { module_id: 'soil', module_name: 'Soil probes', status: 'ok', partial: false, observed_at: '2026-10-26T06:00:00+11:00', readings: [
      { canonical_metric: 'soil_moisture', channel_key: 'SM1', channel_number: 3, source_label: 'Soil Moisture', source_unit: '%', raw_value: 24.5, value: 24.5 },
      { canonical_metric: 'soil_temperature', channel_key: 'ST1', channel_number: 4, source_label: 'Soil Temp', source_unit: '°C', raw_value: 18.2, value: 18.2 },
      { canonical_metric: 'air_temperature', channel_key: 'AT', channel_number: 9, source_label: 'Unmapped temp', source_unit: '°C', raw_value: 21, value: 21 },
    ] },
    { module_id: 'leaf', module_name: 'Canopy sensors', status: 'no_data', partial: false, observed_at: null, readings: [] },
  ],
};
function configWithSensors() {
  const c = maitConfigurationFixture();
  c.modules.push(
    { id: 's1', module_id: 'soil', module_name: 'Soil probes', module_role: 'sensor', irrigation_system_id: null, is_active: true, metadata: {}, updated_at: null },
    { id: 's2', module_id: 'leaf', module_name: 'Canopy sensors', module_role: 'sensor', irrigation_system_id: null, is_active: true, metadata: {}, updated_at: null },
  );
  return c;
}

beforeEach(() => {
  cleanup(); vi.clearAllMocks();
  mocks.manage = true; mocks.connected = true; mocks.supplementaryStatus = 200;
  mocks.config = configWithSensors();
  mocks.rpc.mockImplementation(async (name: string, args: any) => {
    if (name === 'has_mait_intelliweb_manage_access') return { data: mocks.manage };
    if (name === 'has_mait_intelliweb_view_access') return { data: true };
    if (name === 'get_vineyard_weather_integration') return { data: mocks.connected ? [maitIntegrationStatusFixture] : [] };
    if (name === 'get_mait_intelliweb_configuration') return { data: mocks.connected ? mocks.config : {} };
    if (name === 'set_mait_intelliweb_sensor_module') { mocks.config.modules.push({ id: 'new-sensor', module_id: args.p_module_id, module_name: args.p_module_name, module_role: 'sensor', irrigation_system_id: null, is_active: true, metadata: {}, updated_at: null }); return { data: true }; }
    if (name === 'remove_mait_intelliweb_sensor_module') { mocks.config.modules = mocks.config.modules.filter((m: any) => m.module_id !== args.p_module_id); return { data: true }; }
    return { data: true };
  });
  vi.stubGlobal('fetch', vi.fn().mockImplementation(async (_url: string, init: any) => {
    const b = JSON.parse(init.body);
    if (b.action === 'modules') return json({ ok: true, modules: [{ module_id: 'weather', description: 'Weather' }, { module_id: 'controller', description: 'Pump' }, { module_id: 'soil2', description: 'Deep probes' }] });
    if (b.action === 'inspect_module') return json(b.moduleId === 'weather' ? windInspectFixture : soilInspectFixture);
    if (b.action === 'supplementary_current') return json(supplementaryFixture, mocks.supplementaryStatus);
    return json({ ok: true, network_name: 'Farm network', modules: [] });
  }));
});

describe('MAIT wind direction unit and conversions', () => {
  it('treats the exact live "°" wind direction unit as degrees without advanced conversion', () => {
    // Real fixture: label "Wind Direction", unit "°", metric wind_direction.
    expect(maitConversion('°', 'wind_direction')).toEqual({ multiplier: 1, offset: 0 });
    expect(maitConversion('deg', 'wind_direction')).toEqual({ multiplier: 1, offset: 0 });
    expect(maitConversion('degree', 'wind_direction')).toEqual({ multiplier: 1, offset: 0 });
    expect(maitConversion('degrees', 'wind_direction')).toEqual({ multiplier: 1, offset: 0 });
  });
  it('keeps °C/°F temperature handling unchanged', () => {
    expect(maitConversion('°C', 'air_temperature')).toEqual({ multiplier: 1, offset: 0 });
    expect(maitConversion('°F', 'air_temperature')).toEqual({ multiplier: 5 / 9, offset: -32 * 5 / 9 });
    expect(maitConversion('°C', 'soil_temperature')).toEqual({ multiplier: 1, offset: 0 });
    expect(maitConversion('°F', 'soil_temperature')).toEqual({ multiplier: 5 / 9, offset: -32 * 5 / 9 });
  });
  it('keeps soil moisture % and never guesses unknown leaf-wetness units', () => {
    expect(maitConversion('%', 'soil_moisture')).toEqual({ multiplier: 1, offset: 0 });
    expect(maitConversion('cb', 'leaf_wetness')).toBeNull();
    expect(maitConversion('', 'wind_direction')).toBeNull();
  });
});

describe('MAIT wind mapping suggestions', () => {
  it('suggests from labels only', () => {
    expect(maitWindSuggestion('Wind Speed Avg')).toBe('wind_speed');
    expect(maitWindSuggestion('Wind Speed Average')).toBe('wind_speed');
    expect(maitWindSuggestion('Wind Speed Max')).toBe('wind_gust');
    expect(maitWindSuggestion('Wind Speed Min')).toBe('none');
    expect(maitWindSuggestion('Wind Direction')).toBeNull();
    expect(maitWindSuggestion('Rain Fall')).toBeNull();
  });
  it('pre-selects suggestions with the interval hint but never auto-saves', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect weather channels' }));
    await screen.findByRole('combobox', { name: 'Use channel WSAvg as' });
    expect(screen.getByRole('combobox', { name: 'Use channel WSAvg as' })).toHaveTextContent('Wind speed');
    expect(screen.getByRole('combobox', { name: 'Use channel WSMax as' })).toHaveTextContent('Wind gust');
    expect(screen.getByRole('combobox', { name: 'Use channel WSMin as' })).toHaveTextContent('Ignore');
    expect(screen.getAllByText(/interval minimum, average and maximum wind speeds/).length).toBeGreaterThan(0);
    expect(mocks.rpc.mock.calls.some(c => c[0] === 'save_mait_intelliweb_channel_mapping')).toBe(false);
  });
  it('no longer asks to review the unit conversion for a "°" wind direction', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect weather channels' }));
    await screen.findByRole('combobox', { name: 'Use channel WDir as' });
    expect(screen.getByRole('combobox', { name: 'Use channel WDir as' })).toHaveTextContent('Ignore');
    fireEvent.click(screen.getByRole('combobox', { name: 'Use channel WDir as' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Wind direction' }));
    expect(screen.queryByText('Review unit conversion')).not.toBeInTheDocument();
    expect(screen.getAllByText('Advanced conversion').length).toBeGreaterThan(0);
  });
});

describe('MAIT supplementary sensor module configuration', () => {
  it('derives active sensor modules from module_role sensor only', () => {
    const config = maitConfiguration(configWithSensors());
    expect(config.sensorModules.map(m => m.module_id)).toEqual(['soil', 'leaf']);
    const inactive = configWithSensors();
    inactive.modules.push({ id: 's3', module_id: 'old', module_name: 'Old', module_role: 'sensor', irrigation_system_id: null, is_active: false, metadata: {}, updated_at: null });
    expect(maitConfiguration(inactive).sensorModules.map(m => m.module_id)).toEqual(['soil', 'leaf']);
  });
  it('lists both sensor modules on the single existing connection without a second credential form', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByText('Soil probes · Module ID soil')).toBeInTheDocument();
    expect(screen.getByText('Canopy sensors · Module ID leaf')).toBeInTheDocument();
    expect(screen.getByText(/no second username or password is required/)).toBeInTheDocument();
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
  });
  it('tells managers to connect MAIT first when there is no connection', async () => {
    mocks.connected = false;
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByText('Connect MAIT first. Additional sensor modules use the same saved MAIT connection.')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add sensor module' })).not.toBeInTheDocument();
  });
  it('adds a sensor module through the exact RPC, excluding primary/controller/existing sensor modules', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Add sensor module' }));
    fireEvent.click(await screen.findByRole('combobox', { name: 'Sensor module' }));
    const options = await screen.findAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['soil2 · Deep probes']);
    fireEvent.click(options[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Save sensor module' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('set_mait_intelliweb_sensor_module', { p_vineyard_id: 'v', p_module_id: 'soil2', p_module_name: 'Deep probes' }));
    expect((fetch as any).mock.calls.map((c: any) => JSON.parse(c[1].body))).toContainEqual({ vineyardId: 'v', action: 'modules' });
  });
  it('removes a sensor module through the exact RPC after confirmation without touching the connection', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Remove sensor module soil' }));
    const dialog = await screen.findByRole('dialog');
    expect(dialog).toHaveTextContent('This removes the module from VineTrack. It does not change anything in MAIT.');
    fireEvent.click(screen.getAllByRole('button', { name: 'Remove sensor module' }).find(b => dialog.contains(b))!);
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('remove_mait_intelliweb_sensor_module', { p_vineyard_id: 'v', p_module_id: 'soil' }));
    expect(mocks.rpc.mock.calls.some(c => c[0] === 'remove_mait_intelliweb_connection')).toBe(false);
  });
  it('inspects each sensor module and saves mappings through the sensor RPC with only allowed metrics', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect sensor channels for module soil' }));
    const chooser = await screen.findByRole('combobox', { name: 'Use sensor channel SM1 as' });
    expect((fetch as any).mock.calls.map((c: any) => JSON.parse(c[1].body))).toContainEqual({ vineyardId: 'v', action: 'inspect_module', moduleId: 'soil', scope: 'existing' });
    fireEvent.click(chooser);
    const options = await screen.findAllByRole('option');
    expect(options.map(o => o.textContent)).toEqual(['Soil moisture', 'Soil temperature', 'Leaf wetness', 'Ignore']);
    fireEvent.click(options[0]);
    fireEvent.click(screen.getByRole('button', { name: 'Confirm mapping' }));
    await waitFor(() => expect(mocks.rpc).toHaveBeenCalledWith('save_mait_intelliweb_sensor_channel_mapping', expect.objectContaining({
      p_vineyard_id: 'v', p_module_id: 'soil', p_channel_key: 'SM1', p_canonical_metric: 'soil_moisture',
      p_channel_number: 3, p_source_label: 'Soil Moisture', p_source_unit: '%', p_semantics: null,
      p_conversion_multiplier: 1, p_conversion_offset: 0, p_is_active: true,
    })));
    expect(mocks.rpc.mock.calls.some(c => c[0] === 'save_mait_intelliweb_channel_mapping')).toBe(false);
  });
  it('offers exactly the backend-constrained sensor metrics', () => {
    expect(MAIT_SENSOR_METRICS.map(([id]) => id)).toEqual(['soil_moisture', 'soil_temperature', 'leaf_wetness', 'none']);
  });
  it('prefills supplementary saved mappings from weather_mappings by module_id, not a separate array', async () => {
    // Deliberately reuse the same channel key in three modules: only the
    // inspected sensor's saved metric/conversion may be restored.
    mocks.config.weather_mappings = [
      { module_id: 'weather', channel_key: 'SM1', canonical_metric: 'air_temperature', is_active: true, conversion_multiplier: 99, conversion_offset: 99 },
      { module_id: 'leaf', channel_key: 'SM1', canonical_metric: 'leaf_wetness', is_active: true, conversion_multiplier: 7, conversion_offset: 8 },
      { module_id: 'soil', channel_key: 'SM1', canonical_metric: 'soil_moisture', is_active: true, conversion_multiplier: 0.5, conversion_offset: 2 },
    ];
    expect(maitConfiguration(mocks.config).sensorModules.map(m => m.module_id)).toEqual(['soil', 'leaf']);
    mount(<MaitWeatherCard vineyardId="v" />);
    fireEvent.click(await screen.findByRole('button', { name: 'Inspect sensor channels for module soil' }));
    expect(await screen.findByRole('combobox', { name: 'Use sensor channel SM1 as' })).toHaveTextContent('Soil moisture');
    expect(screen.getByLabelText('Sensor channel SM1 multiplier')).toHaveValue(0.5);
    expect(screen.getByLabelText('Sensor channel SM1 offset')).toHaveValue(2);
    expect(mocks.rpc.mock.calls.some(c => c[0] === 'save_mait_intelliweb_sensor_channel_mapping')).toBe(false);
  });
});

describe('MAIT supplementary current readings', () => {
  it('normalises the live envelope and drops unmapped channels', () => {
    const modules = maitSupplementary(supplementaryFixture);
    expect(modules.map(m => m.module_id)).toEqual(['soil', 'leaf']);
    expect(modules[0].readings.map(r => r.canonical_metric)).toEqual(['soil_moisture', 'soil_temperature']);
    expect(modules[1].status).toBe('no_data');
  });
  it('shows mapped soil readings to view-only members without configuration controls or connection details', async () => {
    mocks.manage = false;
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByText('Additional MAIT sensors')).toBeInTheDocument();
    expect(screen.getByText('Soil probes')).toBeInTheDocument();
    expect(screen.getByText(/Soil moisture: 24.5/)).toBeInTheDocument();
    expect(screen.getByText(/Soil temperature: 18.2/)).toBeInTheDocument();
    expect(screen.queryByText(/Unmapped temp/)).not.toBeInTheDocument();
    expect(screen.getByText('No recent data')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add sensor module' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Inspect sensor channels/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Remove sensor module/ })).not.toBeInTheDocument();
    expect(screen.queryByText(/Network ID/)).not.toBeInTheDocument();
    expect((fetch as any).mock.calls.map((c: any) => JSON.parse(c[1].body))).toContainEqual({ vineyardId: 'v', action: 'supplementary_current' });
    expect(mocks.rpc.mock.calls.some(c => c[0] === 'get_mait_intelliweb_configuration')).toBe(false);
    expect(mocks.rpc).toHaveBeenCalledWith('get_vineyard_weather_integration', { p_vineyard_id: 'v', p_provider: 'mait_intelliweb' });
    expect(screen.queryByLabelText('Username')).not.toBeInTheDocument();
    expect(screen.queryByLabelText('Password')).not.toBeInTheDocument();
  });
  it('hides supplementary readings for a view-only member when supplementary_current returns empty modules', async () => {
    mocks.manage = false;
    vi.mocked(fetch).mockResolvedValue(json({ success: true, partial: false, modules: [] }));
    mount(<MaitWeatherCard vineyardId="v" />);
    await waitFor(() => expect(vi.mocked(fetch)).toHaveBeenCalled());
    expect(JSON.parse(vi.mocked(fetch).mock.calls[0][1]?.body as string)).toEqual({ vineyardId: 'v', action: 'supplementary_current' });
    expect(mocks.rpc.mock.calls.some(c => c[0] === 'get_mait_intelliweb_configuration')).toBe(false);
    expect(screen.queryByText('Additional MAIT sensors')).not.toBeInTheDocument();
    expect(screen.queryByText(/Network ID/)).not.toBeInTheDocument();
  });
  it('keeps primary weather intact when a sensor module has no data', async () => {
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByText('No recent data')).toBeInTheDocument();
    expect(screen.getByText('Weather module')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Use MAIT for live observations' })).toBeInTheDocument();
  });
  it('scopes an HTTP 206 partial warning to supplementary sensors only', async () => {
    mocks.supplementaryStatus = 206;
    mount(<MaitWeatherCard vineyardId="v" />);
    expect(await screen.findByText(/partial supplementary sensor data\. Primary MAIT weather is unaffected/)).toBeInTheDocument();
    expect(screen.getByText('Weather module')).toBeInTheDocument();
  });
});
