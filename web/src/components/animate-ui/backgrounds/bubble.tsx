'use client';

import * as React from 'react';
import {
  motion,
  useInView,
  useMotionValue,
  useSpring,
  type SpringOptions,
  type TargetAndTransition,
  type Transition,
} from 'motion/react';

import {
  ReducedMotionConfig,
  useShouldReduceMotion,
} from '@animate-ui/react/utils/motion';
import { usePageVisible } from '@animate-ui/react/utils/use-page-visible';
import { cn } from '@/lib/utils';

/*
  Bubble Background do Animate UI, versão leve do painel: 3 bolhas (em vez de 5), movimento 3× mais lento e sem o
  filtro "goo" + blur(40px) sobre a tela toda (o mais caro: refazia o desfoque da página inteira a cada quadro).
  Os gradientes radiais já são suaves. Para com a aba oculta, fora da tela e com movimento reduzido.
*/

function loop(
  playing: boolean,
  keyframes: TargetAndTransition,
  rest: TargetAndTransition,
  transition: Transition,
) {
  return playing
    ? { initial: rest, animate: keyframes, transition }
    : { initial: rest, animate: rest, transition: { duration: 0 } };
}

const spin = (from: number) => ({ rotate: [from, from + 360] });

type BubbleColors = {
  first: string;
  second: string;
  third: string;
  fourth: string;
  fifth: string;
  sixth: string;
};

type BubbleBackgroundProps = React.ComponentProps<'div'> & {
  interactive?: boolean;
  transition?: SpringOptions;
  colors?: BubbleColors;
};

const grad = (v: string) => `radial-gradient(circle at center, rgba(var(${v}),0.8) 0%, rgba(var(${v}),0) 50%)`;

function BubbleBackgroundContent({
  ref,
  className,
  children,
  interactive = false,
  transition = { stiffness: 60, damping: 20 },
  colors = {
    first: '18,113,255',
    second: '221,74,255',
    third: '0,220,255',
    fourth: '200,50,50',
    fifth: '180,180,50',
    sixth: '140,100,255',
  },
  ...props
}: BubbleBackgroundProps) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  React.useImperativeHandle(ref, () => containerRef.current as HTMLDivElement);

  const mouseX = useMotionValue(0);
  const mouseY = useMotionValue(0);
  const springX = useSpring(mouseX, transition);
  const springY = useSpring(mouseY, transition);

  const inView = useInView(containerRef);
  const pageVisible = usePageVisible();
  const reduce = useShouldReduceMotion();
  const playing = inView && pageVisible && !reduce;

  React.useEffect(() => {
    if (!interactive || reduce) return;

    const el = containerRef.current;
    if (!el) return;

    let frameId: number | null = null;
    const handleMouseMove = (e: MouseEvent) => {
      if (frameId != null) return;
      frameId = requestAnimationFrame(() => {
        frameId = null;
        const rect = el.getBoundingClientRect();
        mouseX.set(e.clientX - (rect.left + rect.width / 2));
        mouseY.set(e.clientY - (rect.top + rect.height / 2));
      });
    };

    window.addEventListener('mousemove', handleMouseMove, { passive: true });
    return () => {
      window.removeEventListener('mousemove', handleMouseMove);
      if (frameId != null) cancelAnimationFrame(frameId);
    };
  }, [interactive, reduce, mouseX, mouseY]);

  return (
    <div
      ref={containerRef}
      data-slot="bubble-background"
      className={cn('relative size-full overflow-hidden', className)}
      {...props}
      style={
        {
          '--first-color': colors.first,
          '--second-color': colors.second,
          '--fifth-color': colors.fifth,
          '--sixth-color': colors.sixth,
          ...props.style,
        } as React.CSSProperties
      }
    >
      <div aria-hidden="true" className="pointer-events-none absolute inset-0">
        <motion.div
          className="absolute rounded-full size-[80%] top-[10%] left-[10%]"
          style={{ background: grad('--first-color'), willChange: 'transform' }}
          {...loop(playing, { y: [-50, 50, -50] }, { y: -50 }, { duration: 90, ease: 'easeInOut', repeat: Infinity })}
        />

        <motion.div
          className="absolute inset-0 flex justify-center items-center origin-[calc(50%-400px)]"
          style={{ willChange: 'transform' }}
          {...loop(playing, spin(0), { rotate: reduce ? 90 : 0 }, { duration: 120, ease: 'linear', repeat: Infinity, repeatType: 'loop' })}
        >
          <div className="rounded-full size-[80%]" style={{ background: grad('--second-color') }} />
        </motion.div>

        <motion.div
          className="absolute inset-0 flex justify-center items-center origin-[calc(50%_-_800px)_calc(50%_+_200px)]"
          style={{ willChange: 'transform' }}
          {...loop(playing, spin(0), { rotate: reduce ? 45 : 0 }, { duration: 150, ease: 'linear', repeat: Infinity })}
        >
          <div className="absolute rounded-full size-[160%] top-[calc(50%-80%)] left-[calc(50%-80%)]" style={{ background: grad('--fifth-color') }} />
        </motion.div>

        {interactive && !reduce && (
          <motion.div
            className="absolute rounded-full size-full opacity-70"
            style={{ background: grad('--sixth-color'), x: springX, y: springY, willChange: 'transform' }}
          />
        )}
      </div>

      {children}
    </div>
  );
}

function BubbleBackground(props: BubbleBackgroundProps) {
  return (
    <ReducedMotionConfig>
      <BubbleBackgroundContent {...props} />
    </ReducedMotionConfig>
  );
}

export { BubbleBackground, type BubbleBackgroundProps };
