import { afterAll, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { UpdaterCard } from "./UpdaterCard";
const state=vi.hoisted(()=>({ stage:"available",currentVersion:"1.0.4",version:"1.0.5",notes:"- Better lyrics\n- Playback fixes\n<script>unsafe</script>",installedRelease:{version:"1.0.4",notes:"Previous changes"} }));
const platform=vi.hoisted(()=>({android:false}));
vi.mock("../../adapters/updater",()=>({getUpdateState:()=>state,subscribeToUpdates:()=>()=>{},supportsWindowsUpdates:()=>!platform.android,supportsAndroidUpdates:()=>platform.android,checkForUpdates:vi.fn(),downloadUpdate:vi.fn(),restartAndUpdate:vi.fn()}));
afterAll(()=>vi.unstubAllGlobals());
it("puts a prominent versioned download button above the release notes, rendering provider text safely",()=>{
 const html=renderToStaticMarkup(<UpdaterCard />);
 expect(html).toContain('class="primary updater-action"');
 expect(html).toContain('Download update v1.0.5');
 expect(html.indexOf("Download update")).toBeLessThan(html.indexOf("Better lyrics"));
 expect(html).toContain("Earlier version");expect(html).toContain("&lt;script&gt;");expect(html).not.toContain("<script>");
});
it.each(["downloading", "ready", "restarting"])("keeps %s actions above release notes", stage=>{
 const original=state.stage;state.stage=stage;
 const html=renderToStaticMarkup(<UpdaterCard />);state.stage=original;
 const action=stage==="downloading" ? 'Update download progress' : stage==="ready" ? 'Restart &amp; Update' : 'Restarting…';
 expect(html.indexOf(action)).toBeGreaterThan(-1);
 expect(html.indexOf(action)).toBeLessThan(html.indexOf('Better lyrics'));
 expect(html).not.toContain('Download update v');
});
it("shows installed release notes when no update is available",()=>{
 const original=state.version;state.version="";
 const html=renderToStaticMarkup(<UpdaterCard />);state.version=original;
 expect(html).toContain("What&#x27;s new in v1.0.4");
 expect(html).toContain("Previous changes");expect(html).not.toContain("Better lyrics");
});
it("describes Android in-place APK updates without claiming a Windows-style installer",()=>{
 platform.android=true;const html=renderToStaticMarkup(<UpdaterCard />);platform.android=false;
 expect(html).toContain("Do not uninstall first");expect(html).toContain("signing certificate");expect(html).toContain("Download Android update");expect(html).not.toContain("Restart &amp; Update");
});

it("formats headings, emphasis and lists without showing Markdown markers",()=>{
 const original=state.notes;
 state.notes="# Lumaire v1.0.5\n\n## Your music\n\n- **Better lyrics**\n- Playback fixes";
 const html=renderToStaticMarkup(<UpdaterCard />);state.notes=original;
 expect(html).toContain("What&#x27;s new in v1.0.5");
 expect(html).not.toContain('<h5>Lumaire v1.0.5</h5>');
 expect(html).toContain('<strong>Better lyrics</strong>');
 expect(html).toContain('<ul><li>');expect(html).not.toContain('## ');expect(html).not.toContain('**');
});

it("collapses older version history while keeping this release expanded",()=>{
 const original=state.notes;
 state.notes="# Lumaire v1.0.5\n\nCurrent improvements\n\n# Lumaire v1.0.4\n\nOld improvements";
 const html=renderToStaticMarkup(<UpdaterCard />);state.notes=original;
 expect(html.indexOf('Current improvements')).toBeLessThan(html.indexOf('<summary>Earlier versions</summary>'));
 expect(html).toContain('<details class="updater-history"><summary>Earlier versions</summary>');
 expect(html).not.toContain('<details open');
});
