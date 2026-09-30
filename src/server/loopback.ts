/** True when the TCP peer is the loopback interface. LAN clients are not loopback. */
export function isLoopbackAddress(address: string | undefined): boolean {
  const host = normalizeIp(address);
  return host === '127.0.0.1' || host === '::1';
}

/**
 * True when the peer is this machine: loopback, or the source address is the
 * address this socket is bound to. A same-machine client of a Tailscale or
 * custom bind uses that bind address as its source. A LAN client does not.
 */
export function isLocalPeer(remoteAddress: string | undefined, localAddress: string | undefined): boolean {
  if (isLoopbackAddress(remoteAddress)) return true;
  const remote = normalizeIp(remoteAddress);
  const local = normalizeIp(localAddress);
  return remote !== '' && remote === local;
}

function normalizeIp(address: string | undefined): string {
  if (!address) return '';
  return address.replace(/^::ffff:/, '').trim();
}
