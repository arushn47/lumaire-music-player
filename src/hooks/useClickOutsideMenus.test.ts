import { describe, it, expect, vi } from "vitest";
import { initClickOutsideMenus } from "./useClickOutsideMenus";

describe("initClickOutsideMenus", () => {
  it("opens on touch hold, suppresses accidental playback, and cancels holds on scrolling", () => {
    vi.useFakeTimers();
    const listeners: Record<string, EventListener> = {};
    const menu = { open: false };
    const row = { querySelector: () => menu };
    const target = { closest: (selector: string) => selector === ".track-row" ? row : null };
    const doc = {
      addEventListener: vi.fn((name, listener, capture) => { listeners[name + (capture ? "Capture" : "")] = listener; }),
      removeEventListener: vi.fn(), querySelectorAll: () => [],
    } as unknown as Document;
    const cleanup = initClickOutsideMenus(doc);
    const down = { pointerType: "touch", target, clientX: 10, clientY: 10 } as unknown as PointerEvent;
    listeners.pointerdown(down);
    vi.advanceTimersByTime(460);
    expect(menu.open).toBe(true);
    const click = { preventDefault: vi.fn(), stopImmediatePropagation: vi.fn() };
    listeners.clickCapture(click as unknown as MouseEvent);
    expect(click.preventDefault).toHaveBeenCalled();
    menu.open = false;
    listeners.pointerdown(down);
    listeners.pointermove({ clientX: 10, clientY: 35 } as PointerEvent);
    vi.advanceTimersByTime(460);
    expect(menu.open).toBe(false);
    cleanup();
    vi.useRealTimers();
  });
  it("closes open track-menu details when pointerdown fires outside", () => {
    const listeners: Record<string, EventListener> = {};
    const mockDetails = {
      open: true,
      contains: vi.fn((target: any) => target === "inside"),
    };
    const mockDoc = {
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        listeners[event] = listener;
      }),
      removeEventListener: vi.fn((event: string) => {
        delete listeners[event];
      }),
      querySelectorAll: vi.fn((selector: string) => {
        if (selector === "details.track-menu[open]") {
          return mockDetails.open ? [mockDetails] : [];
        }
        return [];
      }),
    } as unknown as Document;

    const cleanup = initClickOutsideMenus(mockDoc);
    expect(mockDoc.addEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));
    expect(mockDoc.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));
    expect(mockDoc.addEventListener).toHaveBeenCalledWith("keydown", expect.any(Function));

    // Pointer down outside: target is 'outside'
    listeners.pointerdown({ target: "outside" as any } as PointerEvent);
    expect(mockDetails.open).toBe(false);

    cleanup();
    expect(mockDoc.removeEventListener).toHaveBeenCalledWith("pointerdown", expect.any(Function));
  });

  it("does not close open track-menu when clicking inside", () => {
    const listeners: Record<string, EventListener> = {};
    const mockDetails = {
      open: true,
      contains: vi.fn((target: any) => target === "inside"),
    };
    const mockDoc = {
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        listeners[event] = listener;
      }),
      removeEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => [mockDetails]),
    } as unknown as Document;

    initClickOutsideMenus(mockDoc);

    // Pointer down inside: target is 'inside'
    listeners.pointerdown({ target: "inside" as any } as PointerEvent);
    expect(mockDetails.open).toBe(true);
  });

  it("closes open track-menu when clicking an action item inside popover", () => {
    const listeners: Record<string, EventListener> = {};
    const mockDetails = {
      open: true,
      contains: vi.fn(() => true),
    };
    const mockTarget = {
      closest: vi.fn((selector: string) => {
        if (selector === ".menu-popover button, .menu-popover a") return true;
        if (selector === "details.track-menu") return mockDetails;
        return null;
      }),
    };
    const mockDoc = {
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        listeners[event] = listener;
      }),
      removeEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => [mockDetails]),
    } as unknown as Document;

    initClickOutsideMenus(mockDoc);

    listeners.click({ target: mockTarget as any } as MouseEvent);
    expect(mockDetails.open).toBe(false);
  });

  it("closes open track-menu on Escape key", () => {
    const listeners: Record<string, EventListener> = {};
    const mockDetails = {
      open: true,
    };
    const mockDoc = {
      addEventListener: vi.fn((event: string, listener: EventListener) => {
        listeners[event] = listener;
      }),
      removeEventListener: vi.fn(),
      querySelectorAll: vi.fn(() => [mockDetails]),
    } as unknown as Document;

    initClickOutsideMenus(mockDoc);

    listeners.keydown({ key: "Escape" } as KeyboardEvent);
    expect(mockDetails.open).toBe(false);
  });

  it("opens context menu at mouse coordinates on right click", () => {
    const listeners: Record<string, EventListener> = {};
    const popover = { style: { position: "", left: "", top: "" }, getBoundingClientRect: () => ({ width: 200, height: 200 }) };
    const menu = { open: false, querySelector: (s: string) => s === ".menu-popover" ? popover : null };
    const item = { querySelector: () => menu };
    const target = { closest: (selector: string) => selector === ".track-row" ? null : selector === ".recent-track-item" ? item : null };
    const doc = {
      addEventListener: vi.fn((name, listener) => { listeners[name] = listener; }),
      removeEventListener: vi.fn(),
      querySelectorAll: () => [],
      defaultView: { matchMedia: () => ({ matches: false }), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    } as unknown as Document;
    const cleanup = initClickOutsideMenus(doc);
    const event = { target, clientX: 100, clientY: 150, preventDefault: vi.fn() } as unknown as MouseEvent;
    listeners.contextmenu(event);
    expect(event.preventDefault).toHaveBeenCalled();
    expect(menu.open).toBe(true);
    expect(popover.style.position).toBe("fixed");
    expect(popover.style.left).toBe("100px");
    expect(popover.style.top).toBe("150px");
    cleanup();
  });

  it("suppresses browser menu in search dropdown and opens menu on search option", () => {
    const listeners: Record<string, EventListener> = {};
    const popover = { style: { position: "", left: "", top: "" }, getBoundingClientRect: () => ({ width: 180, height: 150 }) };
    const menu = { open: false, querySelector: (s: string) => s === ".menu-popover" ? popover : null };
    const searchOption = { querySelector: () => menu };
    const targetInOption = {
      closest: (selector: string) => selector === ".topbar-search-option" ? searchOption : selector === ".topbar-search-dropdown" ? true : null,
    };
    const targetInDropdownOnly = {
      closest: (selector: string) => selector === ".topbar-search-dropdown" ? true : null,
    };
    const doc = {
      addEventListener: vi.fn((name, listener) => { listeners[name] = listener; }),
      removeEventListener: vi.fn(),
      querySelectorAll: () => [],
      defaultView: { matchMedia: () => ({ matches: false }), addEventListener: vi.fn(), removeEventListener: vi.fn() },
    } as unknown as Document;
    const cleanup = initClickOutsideMenus(doc);

    // 1. Target in dropdown but not on a menu item: suppresses browser contextmenu
    const emptyEvent = { target: targetInDropdownOnly, clientX: 50, clientY: 50, preventDefault: vi.fn() } as unknown as MouseEvent;
    listeners.contextmenu(emptyEvent);
    expect(emptyEvent.preventDefault).toHaveBeenCalled();

    // 2. Target on search option: opens track menu at coordinates
    const optionEvent = { target: targetInOption, clientX: 200, clientY: 300, preventDefault: vi.fn() } as unknown as MouseEvent;
    listeners.contextmenu(optionEvent);
    expect(optionEvent.preventDefault).toHaveBeenCalled();
    expect(menu.open).toBe(true);
    expect(popover.style.position).toBe("fixed");
    expect(popover.style.left).toBe("200px");
    expect(popover.style.top).toBe("300px");
    cleanup();
  });
});
