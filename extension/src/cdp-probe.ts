export interface CdpProbeResult {
  ok: boolean;
  detail: string;
}

/** Talks to Cursor's Chrome DevTools port. `detail` is a short English reason; the panel translates it. */
export async function probeCdp(cdpUrl: string, fetchImpl: typeof fetch = fetch): Promise<CdpProbeResult> {
  const base = cdpUrl.replace(/\/$/, '');
  try {
    const resp = await fetchImpl(`${base}/json`, { signal: AbortSignal.timeout(2000) });
    if (!resp.ok) return { ok: false, detail: `http ${resp.status}` };
    const body: unknown = await resp.json();
    const pages = Array.isArray(body)
      ? body.filter(item => item && typeof item === 'object' && (item as { type?: string }).type === 'page').length
      : 0;
    if (pages === 0) return { ok: false, detail: 'no-pages' };
    return { ok: true, detail: String(pages) };
  } catch {
    return { ok: false, detail: 'closed' };
  }
}
