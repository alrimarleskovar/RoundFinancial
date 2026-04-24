"use client";

import type { CSSProperties, ReactElement, ReactNode } from "react";

// 24×24 stroke-based icon set, ported from prototype/components/brand.jsx.
// Consumer pattern mirrors the prototype: `<Icons.home size={16} stroke={..} />`.

export interface IconProps {
  size?: number;
  stroke?: string;
  sw?: number;
  fill?: string;
  style?: CSSProperties;
  children?: ReactNode;
}

function Icon({
  size = 22,
  stroke = "currentColor",
  sw = 1.6,
  fill = "none",
  style,
  children,
}: IconProps) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill={fill}
      stroke={stroke}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      style={style}
    >
      {children}
    </svg>
  );
}

type IconFn = (p?: IconProps) => ReactElement;

export const Icons: Record<string, IconFn> = {
  home: (p = {}) => (
    <Icon {...p}>
      <path d="M3 11l9-7 9 7v9a1 1 0 0 1-1 1h-5v-6h-6v6H4a1 1 0 0 1-1-1z" />
    </Icon>
  ),
  groups: (p = {}) => (
    <Icon {...p}>
      <circle cx="8" cy="9" r="3" />
      <circle cx="17" cy="8" r="2.2" />
      <path d="M2 19c0-3 2.7-5 6-5s6 2 6 5" />
      <path d="M14 19c0-2 1.8-3.5 4-3.5s4 1.5 4 3.5" />
    </Icon>
  ),
  score: (p = {}) => (
    <Icon {...p}>
      <path d="M12 3l2.4 5.2 5.6.8-4 4 1 5.6L12 16l-5 2.6 1-5.6-4-4 5.6-.8z" />
    </Icon>
  ),
  wallet: (p = {}) => (
    <Icon {...p}>
      <rect x="3" y="6" width="18" height="13" rx="2.5" />
      <path d="M3 10h18" />
      <circle cx="16.5" cy="14" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  ),
  bell: (p = {}) => (
    <Icon {...p}>
      <path d="M6 10a6 6 0 1 1 12 0v4l2 3H4l2-3z" />
      <path d="M10 20a2 2 0 0 0 4 0" />
    </Icon>
  ),
  arrow: (p = {}) => (
    <Icon {...p}>
      <path d="M5 12h14M13 6l6 6-6 6" />
    </Icon>
  ),
  back: (p = {}) => (
    <Icon {...p}>
      <path d="M19 12H5M11 6l-6 6 6 6" />
    </Icon>
  ),
  plus: (p = {}) => (
    <Icon {...p}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  ),
  check: (p = {}) => (
    <Icon {...p}>
      <path d="M4 12l5 5L20 6" />
    </Icon>
  ),
  lock: (p = {}) => (
    <Icon {...p}>
      <rect x="4" y="10" width="16" height="11" rx="2" />
      <path d="M8 10V7a4 4 0 0 1 8 0v3" />
    </Icon>
  ),
  shield: (p = {}) => (
    <Icon {...p}>
      <path d="M12 2l8 3v7c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V5z" />
    </Icon>
  ),
  spark: (p = {}) => (
    <Icon {...p}>
      <path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M18 6l-2.5 2.5M8.5 15.5L6 18" />
    </Icon>
  ),
  dot: (p = {}) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="3" fill="currentColor" stroke="none" />
    </Icon>
  ),
  refresh: (p = {}) => (
    <Icon {...p}>
      <path d="M3 12a9 9 0 0 1 15.5-6.3L21 3M21 12a9 9 0 0 1-15.5 6.3L3 21" />
      <path d="M21 3v6h-6M3 21v-6h6" />
    </Icon>
  ),
  trend: (p = {}) => (
    <Icon {...p}>
      <path d="M3 17l6-6 4 4 8-8" />
      <path d="M14 7h7v7" />
    </Icon>
  ),
  ticket: (p = {}) => (
    <Icon {...p}>
      <path d="M4 8a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2a2 2 0 0 0 0 4v2a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-2a2 2 0 0 0 0-4z" />
      <path d="M10 6v12" strokeDasharray="2 2" />
    </Icon>
  ),
  send: (p = {}) => (
    <Icon {...p}>
      <path d="M4 12L20 4l-3 16-5-7z" />
      <path d="M12 13l5-9" />
    </Icon>
  ),
  chart: (p = {}) => (
    <Icon {...p}>
      <path d="M4 20V8M10 20V4M16 20v-8M22 20H2" />
    </Icon>
  ),
  user: (p = {}) => (
    <Icon {...p}>
      <circle cx="12" cy="8" r="4" />
      <path d="M4 21c0-4.4 3.6-8 8-8s8 3.6 8 8" />
    </Icon>
  ),
  info: (p = {}) => (
    <Icon {...p}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 8v.01M11 12h1v5h1" />
    </Icon>
  ),
  close: (p = {}) => (
    <Icon {...p}>
      <path d="M6 6l12 12M18 6L6 18" />
    </Icon>
  ),
  eye: (p = {}) => (
    <Icon {...p}>
      <path d="M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12z" />
      <circle cx="12" cy="12" r="3" />
    </Icon>
  ),
  copy: (p = {}) => (
    <Icon {...p}>
      <rect x="8" y="8" width="12" height="12" rx="2" />
      <path d="M16 8V5a1 1 0 0 0-1-1H5a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h3" />
    </Icon>
  ),
};
