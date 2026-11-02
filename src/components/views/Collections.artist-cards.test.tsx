import { expect, it, vi } from 'vitest';
import type { ReactElement, ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Collections } from './Collections';

it('keeps same-name cards clean while navigating to each saved identity', () => {
  const ids = ['saavn:artist:1249318', 'saavn:artist:20043211', 'itunes:1629301422'];
  const onOpen = vi.fn();
  const tree = Collections({ collections: [], query: '', open: vi.fn(), artists: { items: ids.map(id => ({ id, name: 'Gini', artworkUrl: 'https://example.com/portrait.jpg' })), onOpen } });
  const html = renderToStaticMarkup(tree);
  expect(html.match(/Open artist Gini/g)).toHaveLength(3);
  expect(html).not.toMatch(/Apple|JioSaavn|1249318|20043211|1629301422/);
  expect(html).toContain('portrait.jpg');
  function clickArtists(node: ReactNode): void {
    if (Array.isArray(node)) { node.forEach(clickArtists); return; }
    if (!node || typeof node !== 'object') return;
    const element = node as ReactElement<{ children?: ReactNode; onClick?: () => void; 'aria-label'?: string }>;
    if (element.props['aria-label'] === 'Open artist Gini') element.props.onClick?.();
    else clickArtists(element.props.children);
  }
  clickArtists(tree);
  expect(onOpen.mock.calls.map(([id]) => id)).toEqual(ids);
});
