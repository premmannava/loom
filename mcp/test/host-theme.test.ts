import { describe, expect, it } from "vitest";
import { lightTheme, darkTheme } from "../../src/theme";
import { firstFamily, hostTheme, type ReadVar } from "../src/ui/host-theme";

const reader = (vars: Record<string, string>): ReadVar => (name) => vars[name];

describe("matching the host's look", () => {
  it("keeps SayShape's theme when the host sends nothing", () => {
    const t = hostTheme(lightTheme, reader({}));
    expect(t.colors).toEqual(lightTheme.colors);
    expect(t.radius).toEqual(lightTheme.radius);
    expect(t.font).toEqual(lightTheme.font);
  });

  it("takes the host's surface, text, border and status colors, fonts and radii", () => {
    const t = hostTheme(darkTheme, reader({
      "--color-background-primary": "rgb(31, 31, 30)",
      "--color-text-primary": "rgb(250, 249, 245)",
      "--color-text-secondary": "rgb(194, 192, 182)",
      "--color-border-primary": "rgba(222, 220, 209, 0.15)",
      "--color-text-danger": "rgb(255, 120, 120)",
      "--font-sans": '"Host Sans", system-ui, sans-serif',
      "--border-radius-md": "8px",
      "--border-radius-lg": "999px",
    }));
    expect(t.colors.surface).toBe("rgb(31, 31, 30)");
    expect(t.colors.ink).toBe("rgb(250, 249, 245)");
    expect(t.colors.muted).toBe("rgb(194, 192, 182)");
    expect(t.colors.line).toBe("rgba(222, 220, 209, 0.15)");
    expect(t.colors.bad).toBe("rgb(255, 120, 120)");
    expect(t.font.family).toBe('"Host Sans", system-ui, sans-serif');
    expect(t.radius.md).toBe(8);
    // Pill radii would turn cards into ovals, so they're capped.
    expect(t.radius.lg).toBe(24);
  });

  it("keeps SayShape's accent: hosts don't send one", () => {
    const t = hostTheme(lightTheme, reader({ "--color-background-primary": "#fff" }));
    expect(t.colors.accent).toBe(lightTheme.colors.accent);
    expect(t.colors.onAccent).toBe(lightTheme.colors.onAccent);
  });

  it("ignores font values that could break out of a font declaration, and radii that aren't pixels", () => {
    const t = hostTheme(lightTheme, reader({
      "--font-sans": 'x; } body { background: url("evil")',
      "--border-radius-sm": "1rem",
      "--border-radius-md": "-4px",
    }));
    expect(t.font.family).toBe(lightTheme.font.family);
    expect(t.radius.sm).toBe(lightTheme.radius.sm);
    expect(t.radius.md).toBe(lightTheme.radius.md);
  });

  it("finds the first family of a font stack", () => {
    expect(firstFamily('"Anthropic Sans", system-ui')).toBe("Anthropic Sans");
    expect(firstFamily("Inter, sans-serif")).toBe("Inter");
    expect(firstFamily("")).toBeUndefined();
  });
});
