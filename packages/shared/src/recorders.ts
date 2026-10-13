/**
 * Store recorders (NVRs). Shared by the API (direct RTSP capture) and the on-site edge agent, so both
 * build the same stream path for a channel.
 *
 * Connection:
 *  direct – the cloud server opens RTSP to the recorder itself (port-forwarded or public address)
 *  edge   – the cloud cannot reach the recorder; the Foxtail edge agent runs on the store's network,
 *           grabs frames there and sends them to the cloud with a per-store edge token
 */

export const RECORDER_VENDORS = ['uniview', 'hikvision', 'dahua', 'generic', 'custom'] as const;
export type RecorderVendor = (typeof RECORDER_VENDORS)[number];
export const RECORDER_CONNECTIONS = ['direct', 'edge'] as const;
export type RecorderConnection = (typeof RECORDER_CONNECTIONS)[number];
export type StreamProfile = 'sub' | 'main';

export const VENDOR_LABELS: Record<RecorderVendor, string> = {
  uniview: 'Uniview (incl. EZCloud recorders)',
  hikvision: 'Hikvision',
  dahua: 'Dahua',
  generic: 'Generic RTSP',
  custom: 'Custom path',
};

/** Path templates per vendor. Uniview: s0 = main, s1 = sub. Hikvision: 101 main / 102 sub. Dahua: subtype 0 main / 1 sub. */
const TEMPLATES: Record<Exclude<RecorderVendor, 'custom'>, string> = {
  uniview: '/unicast/c{ch}/s{stream}/live',
  hikvision: '/Streaming/Channels/{ch}0{hikstream}',
  dahua: '/cam/realmonitor?channel={ch}&subtype={stream}',
  generic: '/{ch}',
};

/** RTSP path for a 1-based channel. "custom" takes a template with {ch}, {ch0}, {stream}, {profile}. */
export function rtspPathFor(spec: { vendor: RecorderVendor; channel: number; profile?: StreamProfile; pathTemplate?: string | null }): string {
  const ch = spec.channel >= 1 ? spec.channel : 1;
  const profile: StreamProfile = spec.profile === 'main' ? 'main' : 'sub';
  const stream = profile === 'main' ? 0 : 1;
  const template = spec.vendor === 'custom' ? (spec.pathTemplate || '/{ch}') : TEMPLATES[spec.vendor] || TEMPLATES.generic;
  const path = template
    .replace(/\{ch\}/g, String(ch))
    .replace(/\{ch0\}/g, String(ch - 1))
    .replace(/\{stream\}/g, String(stream))
    .replace(/\{hikstream\}/g, profile === 'main' ? '1' : '2')
    .replace(/\{profile\}/g, profile);
  return path.startsWith('/') ? path : `/${path}`;
}

export function buildRtspUrl(spec: { vendor: RecorderVendor; host: string; port?: number | null; username: string; password: string; channel: number; profile?: StreamProfile; pathTemplate?: string | null }): string {
  const u = encodeURIComponent(spec.username);
  const p = encodeURIComponent(spec.password);
  const port = spec.port && spec.port > 0 ? spec.port : 554;
  return `rtsp://${u}:${p}@${spec.host}:${port}${rtspPathFor(spec)}`;
}

/** Strip credentials for logs and API responses. */
export function redactRtsp(url: string): string {
  return url.replace(/rtsp:\/\/[^@/]+@/i, 'rtsp://[redacted]@');
}
