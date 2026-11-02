import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { ExpandedPlayer } from "./ExpandedPlayer";
import { PlayerBar, type PlayerBarProps } from "./PlayerBar";
import { defaults } from "../../domain/types";
import { restoreSession } from "../../domain/session";

it("defaults sessions to Immersive", () => {
  expect(restoreSession({ settings: {} }, []).settings.fullscreenLayout).toBe("immersive");
  expect(restoreSession({ settings: { fullscreenLayout: "minimal" } }, []).settings.fullscreenLayout).toBe("immersive");
  expect(restoreSession({ settings: { fullscreenLayout: "invalid" } }, []).settings.fullscreenLayout).toBe("immersive");
});
it("reuses one transport and renders immersive layout", () => {
  const noop = () => {};
  const session = defaults();
  const props = {session, playback: {status: "paused", time: 0, duration: 20}, tracks: [], downloads: {}, onSetting: noop} as unknown as PlayerBarProps;
  const html = renderToStaticMarkup(<ExpandedPlayer controls={<PlayerBar {...props}/>} lyrics={<div>Lyric fixture</div>} onClose={noop} follow setFollow={noop} canFollow={false} translateLyrics={async()=>{}}/>);
  expect(html).toContain("expanded-player is-immersive");
  expect(html.split('aria-label="Seek playback"')).toHaveLength(2);
});

it("renders track actions menu in expanded-bottom-right beside volume and fullscreen", () => {
  const noop = () => {};
  const session = defaults();
  const track = { id: "t1", title: "Snowman", artist: "Sia", album: "Xmas", duration: 180, fileName: "s.mp3", format: "MP3", missing: false };
  const props = { session, track, playback: { status: "playing", time: 10, duration: 180 }, tracks: [track], downloads: {}, onSetting: noop } as unknown as PlayerBarProps;

  const html = renderToStaticMarkup(
    <ExpandedPlayer controls={<PlayerBar {...props} />} lyrics={null} onClose={noop} follow setFollow={noop} canFollow={false} translateLyrics={async () => {}} />
  );
  // Menu is inside expanded-bottom-right beside volume
  expect(html).toContain("expanded-track-menu");
  const bottomSection = html.slice(html.indexOf('class="expanded-bottom-right"'));
  expect(bottomSection).toContain("expanded-track-menu");

  // Track subtitle row and now-playing remain pure without any menu clutter
  const subtitleRowMatch = html.match(/<div class="track-subtitle-row">([\s\S]*?)<\/div>/);
  expect(subtitleRowMatch?.[1]).not.toContain("track-menu");
  expect(html).not.toContain("current-track-menu");
});
