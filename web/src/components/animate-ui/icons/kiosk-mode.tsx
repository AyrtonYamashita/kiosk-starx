'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

type KioskModeProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    cornersGroup: {
      initial: { scale: 1 },
      animate: {
        scale: [1, 1.1, 1],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
    corners: {},
    body: {},
    shackle: {
      initial: { y: 0 },
      animate: {
        y: [0, -1.5, 0],
        transition: { duration: 0.6, ease: 'easeInOut', delay: 0.1 },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: KioskModeProps) {
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
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...props}
    >
      <motion.g variants={variants.cornersGroup} initial="initial" animate={controls}>
        <motion.path
          d="M3 8V5.5A2.5 2.5 0 0 1 5.5 3H8M16 3h2.5A2.5 2.5 0 0 1 21 5.5V8M21 16v2.5a2.5 2.5 0 0 1-2.5 2.5H16M8 21H5.5A2.5 2.5 0 0 1 3 18.5V16"
          variants={variants.corners}
          initial="initial"
          animate={controls}
        />
      </motion.g>
      <motion.rect x="9" y="11" width="6" height="5" rx="1" variants={variants.body} initial="initial" animate={controls} />
      <motion.path d="M10.2 11V9.8a1.8 1.8 0 0 1 3.6 0V11" variants={variants.shackle} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function KioskMode(props: KioskModeProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  KioskMode,
  KioskMode as KioskModeIcon,
  type KioskModeProps,
  type KioskModeProps as KioskModeIconProps,
};
