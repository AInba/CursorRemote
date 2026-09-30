import { cleanTabTitle } from '../../dom-extractor.js';

export const NOT_LIVE_NOTICE =
  'Not the live tab. This topic updates when you open that tab in Cursor. Other open windows still refresh their current tab in the background.';

export interface LiveTab {
  windowId: string;
  tabTitle: string;
}

export type TopicLiveness = 'live' | 'paused' | 'unknown';

function tabKey(title: string): string {
  return cleanTabTitle(title).toLowerCase();
}

/** Active tab of each snapshot. Snapshots for windows that are not open are ignored. */
export function liveTabsFromSnapshots(
  snapshots: Iterable<{ windowId: string; chatTabs: { title: string; isActive: boolean }[] }>,
  openWindowIds: ReadonlySet<string>,
): LiveTab[] {
  const live: LiveTab[] = [];
  for (const snapshot of snapshots) {
    if (!openWindowIds.has(snapshot.windowId)) continue;
    const active = snapshot.chatTabs.find(tab => tab.isActive)
      ?? (snapshot.chatTabs.length === 1 ? snapshot.chatTabs[0] : undefined);
    if (!active) continue;
    live.push({ windowId: snapshot.windowId, tabTitle: active.title });
  }
  return live;
}

/**
 * A topic is live only while its tab is the one Cursor is showing in that window.
 * Hidden tabs are paused: their DOM is not painted, and switching to them would
 * change the chat the user is looking at.
 */
export function topicLiveness(
  topic: { windowId: string; tabTitle: string },
  liveTabs: LiveTab[],
  openWindowIds: ReadonlySet<string>,
): TopicLiveness {
  if (openWindowIds.size === 0) return 'unknown';
  if (!openWindowIds.has(topic.windowId)) return 'paused';
  const tabs = liveTabs.filter(tab => tab.windowId === topic.windowId);
  if (tabs.length === 0) return 'unknown';
  const key = tabKey(topic.tabTitle);
  return tabs.some(tab => tabKey(tab.tabTitle) === key) ? 'live' : 'paused';
}
