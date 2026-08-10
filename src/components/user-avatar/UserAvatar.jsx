import React, { useId } from 'react';
import { getAvatarById, getAvatarPalette } from '../../../shared/avatarCatalog.js';
import { cn } from '../../lib/utils';

function AvatarPattern({ avatar, palette }) {
  if (avatar.pattern === 'arc') {
    return (
      <>
        <path d="M18 88C34 50 62 24 108 22" fill="none" stroke={palette.secondary} strokeWidth="10" strokeLinecap="round" opacity="0.18" />
        <path d="M14 104C36 72 62 58 104 62" fill="none" stroke={palette.accent} strokeWidth="6" strokeLinecap="round" opacity="0.14" />
      </>
    );
  }

  if (avatar.pattern === 'grid') {
    return (
      <g opacity="0.12" stroke={palette.secondary} strokeWidth="4">
        <path d="M26 18v92" />
        <path d="M64 14v100" />
        <path d="M102 18v92" />
        <path d="M18 34h92" />
        <path d="M14 72h100" />
        <path d="M18 106h92" />
      </g>
    );
  }

  if (avatar.pattern === 'wave') {
    return (
      <>
        <path d="M-6 78C12 62 28 62 46 78C64 94 80 94 98 78C116 62 132 62 150 78" fill="none" stroke={palette.secondary} strokeWidth="8" strokeLinecap="round" opacity="0.16" />
        <path d="M-10 100C10 86 30 86 50 100C70 114 90 114 110 100C130 86 146 86 160 98" fill="none" stroke={palette.accent} strokeWidth="6" strokeLinecap="round" opacity="0.12" />
      </>
    );
  }

  return (
    <g fill={palette.secondary} opacity="0.14">
      <circle cx="30" cy="30" r="7" />
      <circle cx="92" cy="28" r="5" />
      <circle cx="108" cy="86" r="8" />
      <circle cx="34" cy="98" r="5" />
      <circle cx="74" cy="106" r="4" />
    </g>
  );
}

function AvatarGlyph({ glyph, palette }) {
  const strokeProps = {
    fill: 'none',
    stroke: palette.foreground,
    strokeWidth: 6,
    strokeLinecap: 'round',
    strokeLinejoin: 'round',
  };

  switch (glyph) {
    case 'cross':
      return (
        <path
          d="M56 34h16v22h22v16H72v22H56V72H34V56h22V34Z"
          fill={palette.primary}
          stroke={palette.foreground}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      );
    case 'dna':
      return (
        <g {...strokeProps}>
          <path d="M45 30c30 18 30 50 0 68" />
          <path d="M83 30c-30 18-30 50 0 68" />
          <path d="M48 44h32" />
          <path d="M44 64h40" />
          <path d="M48 84h32" />
        </g>
      );
    case 'flask':
      return (
        <g {...strokeProps}>
          <path d="M52 28h24" />
          <path d="M58 28v24L42 86c-3 8 3 14 12 14h20c9 0 15-6 12-14L70 52V28" />
          <path d="M50 78h28" />
        </g>
      );
    case 'book':
      return (
        <g {...strokeProps}>
          <path d="M34 36h28c6 0 10 4 10 10v48c0-6-4-10-10-10H34V36Z" fill={palette.primary} opacity="0.88" />
          <path d="M72 46c0-6 4-10 10-10h12v48H82c-6 0-10 4-10 10" />
          <path d="M44 52h16" />
          <path d="M44 66h16" />
        </g>
      );
    case 'node':
      return (
        <g {...strokeProps}>
          <path d="M47 50l34 18" />
          <path d="M48 84l34-16" />
          <circle cx="42" cy="48" r="12" fill={palette.primary} />
          <circle cx="42" cy="86" r="12" fill={palette.secondary} />
          <circle cx="88" cy="68" r="14" fill={palette.accent} />
        </g>
      );
    case 'chart':
      return (
        <g fill={palette.primary} stroke={palette.foreground} strokeWidth="5" strokeLinejoin="round">
          <rect x="34" y="68" width="14" height="28" rx="3" />
          <rect x="57" y="48" width="14" height="48" rx="3" fill={palette.secondary} />
          <rect x="80" y="34" width="14" height="62" rx="3" fill={palette.accent} />
        </g>
      );
    case 'spark':
      return (
        <path
          d="M64 28l8 24 24 8-24 8-8 24-8-24-24-8 24-8 8-24Z"
          fill={palette.primary}
          stroke={palette.foreground}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      );
    case 'leaf':
      return (
        <g {...strokeProps}>
          <path d="M88 34C58 34 38 52 38 78c0 14 10 24 24 24 26 0 42-28 38-62-4-4-8-6-12-6Z" fill={palette.secondary} />
          <path d="M44 96c12-20 28-34 50-48" />
        </g>
      );
    case 'drop':
      return (
        <path
          d="M64 28c16 20 30 36 30 52 0 18-13 30-30 30S34 98 34 80c0-16 14-32 30-52Z"
          fill={palette.primary}
          stroke={palette.foreground}
          strokeWidth="5"
          strokeLinejoin="round"
        />
      );
    case 'pill':
      return (
        <g transform="rotate(-35 64 64)">
          <rect x="30" y="51" width="68" height="26" rx="13" fill={palette.primary} stroke={palette.foreground} strokeWidth="5" />
          <path d="M64 51v26" stroke={palette.foreground} strokeWidth="5" strokeLinecap="round" />
        </g>
      );
    case 'orbit':
      return (
        <g {...strokeProps}>
          <ellipse cx="64" cy="64" rx="34" ry="14" transform="rotate(-20 64 64)" />
          <ellipse cx="64" cy="64" rx="34" ry="14" transform="rotate(55 64 64)" />
          <circle cx="64" cy="64" r="10" fill={palette.primary} />
          <circle cx="88" cy="44" r="5" fill={palette.accent} stroke="none" />
        </g>
      );
    case 'pulse':
    default:
      return (
        <g {...strokeProps}>
          <path d="M28 68h16l8-22 18 44 10-22h20" />
          <circle cx="64" cy="64" r="34" stroke={palette.primary} opacity="0.45" />
        </g>
      );
  }
}

export default function UserAvatar({
  avatarId,
  seed,
  size = 40,
  className = '',
  label = 'User avatar',
  decorative = false,
}) {
  const avatar = getAvatarById(avatarId, seed);
  const palette = getAvatarPalette(avatar);
  const gradientId = useId().replace(/:/g, '');
  const dimension = typeof size === 'number' ? `${size}px` : size;

  return (
    <svg
      viewBox="0 0 128 128"
      width={dimension}
      height={dimension}
      role={decorative ? undefined : 'img'}
      aria-hidden={decorative ? true : undefined}
      aria-label={decorative ? undefined : label}
      className={cn('block shrink-0 overflow-hidden rounded-full border border-black/10 shadow-sm dark:border-white/10', className)}
    >
      <defs>
        <linearGradient id={`avatar-gradient-${gradientId}`} x1="18" y1="16" x2="110" y2="112" gradientUnits="userSpaceOnUse">
          <stop stopColor={palette.background} />
          <stop offset="1" stopColor={palette.primary} stopOpacity="0.16" />
        </linearGradient>
      </defs>
      <rect width="128" height="128" rx="64" fill={`url(#avatar-gradient-${gradientId})`} />
      <AvatarPattern avatar={avatar} palette={palette} />
      <circle cx="94" cy="34" r="22" fill={palette.accent} opacity="0.12" />
      <circle cx="34" cy="96" r="18" fill={palette.primary} opacity="0.1" />
      <AvatarGlyph glyph={avatar.glyph} palette={palette} />
    </svg>
  );
}
