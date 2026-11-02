import { useMemo, useState } from 'react';
import { ArrowLeftRight, Check, Copy, Heart, History, Link2, RefreshCw, ShieldCheck, Wifi } from 'lucide-react';
import qrcode from 'qrcode-generator';
import type { useNearby } from '../../hooks/useNearby';

export function NearbyDevices({ nearby }: { nearby: ReturnType<typeof useNearby> }) {
  const [link, setLink] = useState(''), [message, setMessage] = useState('');
  const paired = !!nearby.guestLink, sharing = !!nearby.hostLink;
  const peerConnected = Boolean(nearby.peer || (nearby.lastSyncedAt && (paired || sharing)));
  const peerName = nearby.peer?.name || (paired ? 'Your paired device' : sharing ? 'Connected device' : '');
  const state = nearby.error ? 'retrying' : nearby.syncing || nearby.busy ? 'working' : (peerConnected || nearby.lastSyncedAt) ? 'synced' : sharing ? 'sharing' : paired ? 'waiting' : 'ready';
  const status = { retrying: 'Waiting for your device', working: 'Syncing your music', synced: nearby.peer?.name ? `Connected to ${nearby.peer.name}` : 'Everything is up to date', sharing: 'Ready to pair', waiting: 'Connecting to your device', ready: 'Keep your music together' }[state];
  const pairingQr = useMemo(() => {
    if (!nearby.hostLink) return '';
    const code = qrcode(0, 'M'); code.addData(nearby.hostLink); code.make();
    return code.createDataURL(6, 24);
  }, [nearby.hostLink]);
  const report = (e: unknown) => setMessage(String(e));
  return <section className="device-sync" aria-label="Device sync">
    <header className="device-sync-heading"><span className="device-sync-mark"><ArrowLeftRight size={22} /></span><div><h2>Your devices, together</h2><p>Your playlists, favorites and listening, across devices. No account needed.</p></div></header>
    <div className="device-sync-status" data-state={state} role="status" aria-live="polite">
      {state === 'synced' ? <Check size={19} /> : <Wifi size={19} />}
      <div><strong>{status}</strong><p>{nearby.error ? 'Changes are safe on this device. We’ll reconnect automatically.' : nearby.lastSyncedAt ? `Last synced at ${new Date(nearby.lastSyncedAt).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Keep both apps open on the same Wi-Fi.'}</p>
        {nearby.error && <details className="device-sync-error"><summary>Connection details</summary><p>{nearby.error}</p></details>}
      </div>
      {(paired || sharing) && <button type="button" className="device-sync-retry" aria-label="Retry device sync" disabled={nearby.syncing || nearby.busy} onClick={() => void nearby.sync().catch(() => {})}><RefreshCw size={18} className={nearby.syncing ? 'device-sync-spinning' : ''} /></button>}
    </div>
    {sharing && peerConnected ? (
      <section className="device-sync-card device-sync-paired" aria-label="Paired connection">
        <div><h3>{peerName}</h3><p>Playlist additions, edits and removals merge automatically.</p></div>
        <div className="device-sync-actions">
          <button type="button" className="primary" disabled={nearby.syncing || nearby.busy} onClick={() => void nearby.sync().catch(() => {})}>
            <RefreshCw size={16} className={nearby.syncing ? 'device-sync-spinning' : ''} />{nearby.syncing ? 'Syncing…' : 'Sync now'}
          </button>
          <button type="button" className="subtle" onClick={() => void nearby.stop()}>{sharing ? 'Stop sharing' : 'Disconnect'}</button>
        </div>
        <details className="pairing-link-fallback" style={{ marginTop: 16 }}>
          <summary>Show pairing code / Pair another device</summary>
          <div className="pairing-qr-panel" style={{ marginTop: 12 }}>
            <img className="pairing-qr" src={pairingQr} alt="QR code for this device's Lumaire pairing link" />
            <div>
              <h3>Scan to pair</h3>
              <ol><li>Scan this code with your other device.</li><li>Copy the link from the local pairing page.</li><li>Open Lumaire → Sync → Devices and connect.</li></ol>
              <button type="button" className="primary" onClick={() => void navigator.clipboard.writeText(nearby.hostLink).then(() => setMessage('Pairing link copied.')).catch(() => setMessage('Open Show pairing link, then select and copy the link.'))}><Copy size={16} />Copy pairing link</button>
            </div>
          </div>
          <label htmlFor="sync-share-link">Pairing link</label>
          <input id="sync-share-link" readOnly value={nearby.hostLink} onFocus={event => event.target.select()} />
        </details>
      </section>
    ) : sharing ? <section className="device-sync-card" aria-label="Share this device">
      <div className="pairing-qr-panel"><img className="pairing-qr" src={pairingQr} alt="QR code for this device's Lumaire pairing link" />
        <div><h3>Scan to pair</h3><ol><li>Scan this code with your other device.</li><li>Copy the link from the local pairing page.</li><li>Open Lumaire → Sync → Devices and connect.</li></ol><button type="button" className="primary" onClick={() => void navigator.clipboard.writeText(nearby.hostLink).then(() => setMessage('Pairing link copied.')).catch(() => setMessage('Open Show pairing link, then select and copy the link.'))}><Copy size={16} />Copy pairing link</button></div>
      </div><details className="pairing-link-fallback"><summary>Show pairing link</summary><label htmlFor="sync-share-link">Pairing link</label><input id="sync-share-link" readOnly value={nearby.hostLink} onFocus={event => event.target.select()} /></details>
    </section> : !paired && <section className="device-sync-card" aria-label="Pair a device">
      <h3>Connect your other device</h3><p>Paste the pairing link shown in Lumaire on your other device.</p>
      <form className="device-sync-form" onSubmit={event => { event.preventDefault(); setMessage(''); void nearby.connect(link.trim()); }}>
        <label htmlFor="sync-pair-link" className="device-sync-label">Pairing link</label>
        <div className="device-sync-input-row">
          <div className="device-sync-input"><Link2 size={16} /><input id="sync-pair-link" type="text" inputMode="url" autoCapitalize="none" autoCorrect="off" spellCheck={false} placeholder="http://192.168…" value={link} onChange={event => setLink(event.target.value)} /></div>
          <button type="submit" className="primary device-sync-connect-btn" disabled={nearby.busy || !link.trim()}>{nearby.busy ? 'Connecting…' : 'Connect'}</button>
        </div>
      </form><div className="device-sync-divider"><span>or start here</span></div>
      <button type="button" className="subtle device-sync-share" disabled={nearby.busy} onClick={() => void nearby.start()}><ArrowLeftRight size={17} />Share from this device</button>
    </section>}
    {paired && <section className="device-sync-card device-sync-paired" aria-label="Paired connection"><div><h3>{peerName || 'Your paired device'}</h3><p>Playlist additions, edits and removals merge automatically.</p></div><div className="device-sync-actions"><button type="button" className="primary" disabled={nearby.syncing || nearby.busy} onClick={() => void nearby.sync().catch(() => {})}><RefreshCw size={16} className={nearby.syncing ? 'device-sync-spinning' : ''} />{nearby.syncing ? 'Syncing…' : 'Sync now'}</button><button type="button" className="subtle" onClick={() => void nearby.stop()}>Disconnect</button></div></section>}
    <section className="device-sync-card" aria-label="What to sync"><h3>What to sync</h3>
      <div className="device-sync-setting"><span className="device-sync-setting-icon"><Heart size={20} /></span><div><strong id="sync-favorites-label">Favorites</strong><p>Sync liked tracks, artists and albums. Enabled by default on updated devices.</p></div><label className="apple-switch"><input type="checkbox" role="switch" aria-labelledby="sync-favorites-label" checked={nearby.favoritesEnabled !== false} disabled={nearby.syncing} onChange={event => void nearby.setFavoritesSync(event.target.checked).catch(report)} /><span className="apple-switch-track" /></label></div>
      <div className="device-sync-setting"><span className="device-sync-setting-icon"><History size={20} /></span><div><strong id="sync-history-label">Listening history</strong><p>Update Tracker and recommendations on both devices.</p></div><label className="apple-switch"><input type="checkbox" role="switch" aria-labelledby="sync-history-label" checked={nearby.historyEnabled || false} disabled={nearby.syncing} onChange={event => void nearby.setHistorySync(event.target.checked).catch(report)} /><span className="apple-switch-track" /></label></div>
      <p className="device-sync-note">Listening history is off by default. Enable it on both devices. History clears sync too; offline plays recorded before a device learns about a clear are discarded.</p>
    </section>
    <footer className="device-sync-privacy"><ShieldCheck size={16} /><p>Use a trusted private network. Traffic is not encrypted; keep your pairing link private. Audio files, keys and device settings stay on each device.</p></footer>
    {message && <p className="device-sync-message" role="status">{message}</p>}
  </section>;
}
