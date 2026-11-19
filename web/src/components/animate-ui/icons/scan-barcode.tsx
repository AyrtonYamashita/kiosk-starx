'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '@animate-ui/react/icons';

type ScanBarcodeProps = IconProps<keyof typeof animations>;

const bar = (delay: number): Variants => ({
  initial: { scaleY: 1 },
  animate: {
    scaleY: [1, 0.55, 1],
    transition: { duration: 0.45, ease: 'easeInOut', delay },
  },
});

const animations = {
  default: {
    frameGroup: {
      initial: { scale: 1 },
      animate: {
        scale: [1, 1.08, 1],
        transition: { duration: 0.6, ease: 'easeInOut' },
      },
    },
    corner1: {},
    corner2: {},
    corner3: {},
    corner4: {},
    bar1: bar(0),
    bar2: bar(0.1),
    bar3: bar(0.2),
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: ScanBarcodeProps) {
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
      {...props}
    >
      <motion.g variants={variants.frameGroup} initial="initial" animate={controls}>
        <motion.path d="M3 7V5a2 2 0 0 1 2-2h2" variants={variants.corner1} initial="initial" animate={controls} />
        <motion.path d="M17 3h2a2 2 0 0 1 2 2v2" variants={variants.corner2} initial="initial" animate={controls} />
        <motion.path d="M21 17v2a2 2 0 0 1-2 2h-2" variants={variants.corner3} initial="initial" animate={controls} />
        <motion.path d="M7 21H5a2 2 0 0 1-2-2v-2" variants={variants.corner4} initial="initial" animate={controls} />
      </motion.g>
      <motion.path d="M8 7v10" variants={variants.bar1} initial="initial" animate={controls} />
      <motion.path d="M12 7v10" variants={variants.bar2} initial="initial" animate={controls} />
      <motion.path d="M17 7v10" variants={variants.bar3} initial="initial" animate={controls} />
    </motion.svg>
  );
}

function ScanBarcode(props: ScanBarcodeProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  ScanBarcode,
  ScanBarcode as ScanBarcodeIcon,
  type ScanBarcodeProps,
  type ScanBarcodeProps as ScanBarcodeIconProps,
};
