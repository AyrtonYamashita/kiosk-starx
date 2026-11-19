'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

type QrCodeProps = IconProps<keyof typeof animations>;

const bit = (delay: number): Variants => ({
  initial: { opacity: 1 },
  animate: {
    opacity: [1, 0.2, 1],
    transition: { duration: 0.5, ease: 'easeInOut', delay },
  },
});

const animations = {
  default: {
    group: {
      initial: { scale: 1 },
      animate: {
        scale: [1, 1.1, 1],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
    finder1: {},
    finder2: {},
    finder3: {},
    corner: {},
    bit1: bit(0),
    hook: {},
    bit2: bit(0.08),
    bit3: bit(0.16),
    bit4: bit(0.24),
    bit5: bit(0.12),
    bit6: bit(0.2),
    bit7: bit(0.28),
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: QrCodeProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={variants.group}
      initial="initial"
      animate={controls}
      {...props}
    >
      <motion.rect width="5" height="5" x="3" y="3" rx="1" variants={variants.finder1} initial="initial" animate={controls} />
      <motion.rect width="5" height="5" x="16" y="3" rx="1" variants={variants.finder2} initial="initial" animate={controls} />
      <motion.rect width="5" height="5" x="3" y="16" rx="1" variants={variants.finder3} initial="initial" animate={controls} />
      <motion.path d="M21 16h-3a2 2 0 0 0-2 2v3" variants={variants.corner} initial="initial" animate={controls} />
      <motion.path d="M21 21v.01" variants={variants.bit1} initial="initial" animate={controls} />
      <motion.path d="M12 7v3a2 2 0 0 1-2 2H7" variants={variants.hook} initial="initial" animate={controls} />
      <motion.path d="M3 12h.01" variants={variants.bit2} initial="initial" animate={controls} />
      <motion.path d="M12 3h.01" variants={variants.bit3} initial="initial" animate={controls} />
      <motion.path d="M12 16v.01" variants={variants.bit4} initial="initial" animate={controls} />
      <motion.path d="M16 12h1" variants={variants.bit5} initial="initial" animate={controls} />
      <motion.path d="M21 12v.01" variants={variants.bit6} initial="initial" animate={controls} />
      <motion.path d="M12 21v-1" variants={variants.bit7} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function QrCode(props: QrCodeProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  QrCode,
  QrCode as QrCodeIcon,
  type QrCodeProps,
  type QrCodeProps as QrCodeIconProps,
};
