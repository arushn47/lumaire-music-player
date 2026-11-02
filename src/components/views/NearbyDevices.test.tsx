import { expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { NearbyDevices } from "./NearbyDevices";
import type { useNearby } from "../../hooks/useNearby";

const hostLink = 'http://192.168.1.8:50575/#0123456789abcdef0123456789abcdef';
const nearby = { hostLink, guestLink: '', busy: false, error: '' } as ReturnType<typeof useNearby>;
const render = (link: string) => renderToStaticMarkup(<NearbyDevices nearby={{ ...nearby, hostLink: link }} />);

it('generates the pairing QR locally and keeps the text/copy fallback', () => {
  const html = render(hostLink);
  expect(html).toContain('src="data:image/gif;base64,');
  expect(html).toContain('QR code for this device&#x27;s Lumaire pairing link');
  expect(html).toContain('Show pairing link');
  expect(html).toContain(`value="${hostLink}"`);
  expect(html).toContain('Copy pairing link');
  expect(html).toContain('local pairing page');
});
it('changes the code for a new pairing token and removes it when sharing stops', () => {
  const image = (html: string) => html.match(/src="([^"]+)"/)?.[1];
  expect(image(render(hostLink))).not.toBe(image(render(hostLink.replace('0123456789abcdef0123456789abcdef', 'abcdef0123456789abcdef0123456789'))));
  expect(render('')).not.toContain('data:image/gif');
  expect(render('')).toContain('Share from this device');
});
it('keeps a recovered connection clear of stale retry messages and exposes optional history as a switch', () => {
  const html = renderToStaticMarkup(<NearbyDevices nearby={{ ...nearby, hostLink: '', guestLink: hostLink, lastSyncedAt: Date.now(), error: '', syncing: false }} />);
  expect(html).toContain('Everything is up to date');
  expect(html).toContain('aria-labelledby="sync-history-label"');
  expect(html).toMatch(/aria-labelledby="sync-favorites-label"[^>]*checked=""/);
  expect(html).not.toContain('Connection details');
  expect(html).not.toContain('role="alert"');
});
it('uses a single reconnect status instead of stacking connection error alerts', () => {
  const html = renderToStaticMarkup(<NearbyDevices nearby={{ ...nearby, guestLink: hostLink, error: 'Cannot reach paired device' }} />);
  expect(html).toContain('Waiting for your device');
  expect(html).toContain('Changes are safe on this device');
  expect(html).not.toContain('role="alert"');
  expect(html.match(/Cannot reach paired device/g)).toHaveLength(1);
});

it('detects connected phone on host and collapses the pairing QR code', () => {
  const html = renderToStaticMarkup(
    <NearbyDevices
      nearby={{
        ...nearby,
        hostLink,
        lastSyncedAt: Date.now(),
        peer: { deviceId: 'phone-123', name: 'Android Phone', lastSeen: Date.now() },
      }}
    />
  );
  expect(html).toContain('Connected to Android Phone');
  expect(html).toContain('Show pairing code / Pair another device');
  expect(html).toContain('Sync now');
  expect(html).toContain('Stop sharing');
});

