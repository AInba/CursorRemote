export type TransportLinkState = 'disabled' | 'starting' | 'ready' | 'error';

export interface TransportLinkStatus {
  state: TransportLinkState;
  detail: string;
}

export interface TransportLinks {
  feishu: TransportLinkStatus;
  qq: TransportLinkStatus;
}

const links: TransportLinks = {
  feishu: { state: 'disabled', detail: '' },
  qq: { state: 'disabled', detail: '' },
};

export function setTransportLink(
  name: keyof TransportLinks,
  state: TransportLinkState,
  detail: string,
): void {
  links[name] = { state, detail };
}

export function getTransportLinks(): TransportLinks {
  return {
    feishu: { ...links.feishu },
    qq: { ...links.qq },
  };
}
