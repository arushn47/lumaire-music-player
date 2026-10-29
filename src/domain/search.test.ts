import { expect, it } from "vitest";
import { localSearchMatches } from "./search";
it("matches partial metadata in any token order without dropping Indic marks", () => {
 expect(localSearchMatches("singh kesar", "Kesariya", "Arijit Singh")).toBe(true);
 expect(localSearchMatches("केसरिया", "केसरिया")).toBe(true);
 expect(localSearchMatches("कसरिया", "केसरिया")).toBe(false);
 expect(localSearchMatches("wrong kesar", "Kesariya", "Arijit Singh")).toBe(false);
 expect(localSearchMatches("", "Anything")).toBe(true);
});
