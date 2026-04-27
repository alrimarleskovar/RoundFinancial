"use client";

// Brand glyphs for each integration card. Mirrors the prototype's
// ConnectionGlyph in desktop-more.jsx.

export type GlyphKind = "phantom" | "civic" | "kamino" | "solflare" | "pix";

export function ConnectionGlyph({
  kind,
  color,
  size = 20,
}: {
  kind: GlyphKind;
  color: string;
  size?: number;
}) {
  const s = { width: size, height: size };
  switch (kind) {
    case "phantom":
      return (
        <svg viewBox="0 0 24 24" style={s} fill={color}>
          <path d="M12 2.5c-5 0-9 3.8-9 9.3v8a1.3 1.3 0 0 0 2.2.9l1.4-1.4a1 1 0 0 1 1.4 0l1.1 1a1.1 1.1 0 0 0 1.6 0l1.1-1a1 1 0 0 1 1.4 0l1.1 1a1.1 1.1 0 0 0 1.6 0l1.1-1a1 1 0 0 1 1.4 0l1.4 1.4a1.3 1.3 0 0 0 2.2-.9v-8c0-5.5-4-9.3-9-9.3zm-3.5 10a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6zm7 0a1.3 1.3 0 1 1 0-2.6 1.3 1.3 0 0 1 0 2.6z" />
        </svg>
      );
    case "civic":
      return (
        <svg
          viewBox="0 0 24 24"
          style={s}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z" />
          <path d="M8.5 12.5l2.5 2.5 4.5-5" />
        </svg>
      );
    case "kamino":
      return (
        <svg
          viewBox="0 0 24 24"
          style={s}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M4 18 Q 8 10 12 14 Q 16 18 20 10" />
          <circle cx="4" cy="18" r="1.4" fill={color} />
          <circle cx="20" cy="10" r="1.4" fill={color} />
        </svg>
      );
    case "solflare":
      return (
        <svg
          viewBox="0 0 24 24"
          style={s}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <circle cx="12" cy="12" r="4" />
          <path d="M12 3v3M12 18v3M3 12h3M18 12h3M5.6 5.6l2.1 2.1M16.3 16.3l2.1 2.1M5.6 18.4l2.1-2.1M16.3 7.7l2.1-2.1" />
        </svg>
      );
    case "pix":
      return (
        <svg
          viewBox="0 0 24 24"
          style={s}
          fill="none"
          stroke={color}
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M12 3l4 4-4 4-4-4z" />
          <path d="M12 13l4 4-4 4-4-4z" />
          <path d="M3 12l4-4 4 4-4 4z" />
          <path d="M13 12l4-4 4 4-4 4z" />
        </svg>
      );
  }
}
