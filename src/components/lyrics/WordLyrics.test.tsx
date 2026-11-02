import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { expect, it } from "vitest";
import { WordLyrics } from "./WordLyrics";
import { parseLyrics } from "../../domain/lyrics";

it("renders from the actual supplied clock without an independent animation", () => {
  const line = parseLyrics("[00:01]<00:01>Hello <00:02>世界<00:03>").lines[0];
  const at = (clock: number) => renderToStaticMarkup(<WordLyrics line={line} clock={clock}/>);
  expect(at(1500)).toContain("--word-progress:50%");
  expect(at(1500)).toContain('data-word-state="active"');
  expect(at(1500)).toBe(at(1500));
  expect(at(500)).not.toContain('data-word-state="active"');
  expect(at(2500)).toContain('data-word-state="sung"');
  expect(at(2000)).not.toContain('data-word-state="sung" style="--word-lift:0px"');
  expect(renderToStaticMarkup(<WordLyrics line={parseLyrics("next song").lines[0]} clock={2500}/>)).toBe("next song");
});

it("reuses source word timings for matching romanized tokens", () => {
  const line = parseLyrics("[00:01]<00:01>तेरा <00:02>हुआ<00:03>").lines[0];
  const html = renderToStaticMarkup(<WordLyrics line={line} text="Tera Hua" clock={1500}/>);
  expect(html).toContain(">Tera</span>");
  expect(html).toContain("--word-progress:50%");
  expect(html.match(/class=\"lyric-word\"/g)).toHaveLength(2);
});

it("leaves romanized text plain when it cannot align to source word timings", () => {
  const line = parseLyrics("[00:01]<00:01>तेरा हुआ <00:02>साहिबा<00:03>").lines[0];
  const html = renderToStaticMarkup(<WordLyrics line={line} text="Tera Hua Sahibaa" clock={1500}/>);
  expect(html).toBe("Tera Hua Sahibaa");
});

it("overlaps slow rises across words and keeps sung words raised instead of pulsing down", () => {
  const line = parseLyrics("[00:01]<00:01>One <00:01.3>two<00:02>").lines[0];
  const lifts = (clock: number) => [...renderToStaticMarkup(<WordLyrics line={line} clock={clock}/>).matchAll(/--word-lift:([^p]+)px/g)].map(m => Number(m[1]));
  const samples = [1000, 1100, 1300, 1600, 2000, 3000].map(clock => lifts(clock)[0]);
  expect(samples[0]).toBe(0);
  expect(samples.at(-1)).toBe(-3);
  expect(samples.every((value, i) => value >= -3 && (i === 0 || value <= samples[i - 1]))).toBe(true);
  expect(lifts(1600)[0]).toBeLessThan(lifts(1600)[1]);
  expect(lifts(1600)[1]).toBeLessThan(0);
  expect(lifts(900)).toEqual([0, 0]);
});
