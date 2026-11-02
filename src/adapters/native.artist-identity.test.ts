import { beforeEach, expect, it, vi } from 'vitest';

const invoke = vi.hoisted(() => vi.fn());
vi.mock('@tauri-apps/api/core', () => ({ isTauri: () => true, invoke }));
beforeEach(() => { vi.resetModules(); invoke.mockReset(); });
const profile = (id: string) => ({ info: { id, name: 'Gini' }, topTracks: [], albums: [], similarArtists: [] });

it('accepts a canonical profile only when the requested credit ID is explicitly verified', async () => {
  invoke.mockResolvedValue({ ...profile('saavn:artist:20043211'), verifiedIds: ['saavn:artist:20043211', 'itunes:1629301422'] });
  const { library } = await import('./native');
  expect((await library.lookupArtist('itunes:1629301422')).info.id).toBe('saavn:artist:20043211');
  await expect(library.lookupArtist('saavn:artist:1249318')).rejects.toThrow('different artist identity');
});

it('coalesces one identity while keeping the three Gini cache entries separate', async () => {
  invoke.mockImplementation(async (_command, { id }) => profile(id));
  const { library } = await import('./native');
  for (const id of ['saavn:artist:1249318', 'saavn:artist:20043211', 'itunes:1629301422']) {
    const [first, second] = await Promise.all([library.lookupArtist(id), library.lookupArtist(id)]);
    expect(first.info.id).toBe(id); expect(second.info.id).toBe(id);
  }
  expect(invoke).toHaveBeenCalledTimes(3);
});

it('rejects and evicts a different provider identity instead of poisoning the requested cache', async () => {
  invoke.mockResolvedValueOnce(profile('itunes:1629301422')).mockResolvedValueOnce(profile('saavn:artist:1249318'));
  const { library } = await import('./native');
  await expect(library.lookupArtist('saavn:artist:1249318')).rejects.toThrow('different artist identity');
  expect((await library.lookupArtist('saavn:artist:1249318')).info.id).toBe('saavn:artist:1249318');
  expect(invoke).toHaveBeenCalledTimes(2);
});
