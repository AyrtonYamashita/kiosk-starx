'use client';

import * as React from 'react';
import { ViewTransition } from 'react';
import type { TargetAndTransition, Transition } from 'motion/react';
import {
  applyGeneratorOptions,
  getValueTransition,
  getViewAnimationLayerInfo,
  getViewAnimations,
  GroupAnimation,
  mapEasingToNativeEasing,
  NativeAnimation,
  NativeAnimationWrapper,
} from 'motion-dom';
import { secondsToMilliseconds } from 'motion-utils';

/*
  AnimateView do Motion (motion/react-animate-view), versão do painel: só entrada e saída (troca de página).
  O original deixa o <ViewTransition> do React com update = "auto", e então qualquer atualização dentro da página
  (router.refresh, formulário, dado ao vivo) abria uma view transition: a tela congelava até o React terminar a
  atualização e piscava no crossfade. Aqui update e share ficam "none"; o resto é o mesmo código do Motion.
*/

type Kind = 'enter' | 'exit';
type Definition = TargetAndTransition | ((types: string[]) => TargetAndTransition);

type AnimateViewProps = {
  children: React.ReactNode;
  enter?: Definition;
  exit?: Definition;
  transition?: Transition;
};

let resetInserted = false;

function useResetViewTransitions() {
  React.useInsertionEffect(() => {
    if (resetInserted) return;
    resetInserted = true;
    const style = document.createElement('style');
    style.textContent =
      '::view-transition-group(*), ::view-transition-old(*), ::view-transition-new(*) { animation-timing-function: linear !important; }';
    document.head.appendChild(style);
  }, []);
}

type Options = Record<string, unknown> & { duration?: number; delay?: number; ease?: unknown };

function animateLayers(name: string, type: Kind, props: AnimateViewProps, types: string[]) {
  const layerAnimations: unknown[] = [];
  const definition = props[type];
  const { transition: typeTransition, ...values } = ((typeof definition === 'function' ? definition(types) : definition) ?? {}) as TargetAndTransition;
  const hasValues = Object.keys(values).length > 0;
  let hasMatching = false;
  for (const viewAnimation of getViewAnimations()) {
    if (viewAnimation.playState === 'finished') continue;
    const { effect } = viewAnimation;
    if (!(effect instanceof KeyframeEffect) || !effect.pseudoElement) continue;
    const info = getViewAnimationLayerInfo(effect.pseudoElement);
    if (!info || info.layer !== name) continue;
    hasMatching = true;
    if (hasValues && info.type !== 'group') {
      viewAnimation.cancel();
    } else {
      const transitionName = info.type === 'group' ? 'layout' : '';
      let options = {
        ...(getValueTransition(props.transition as never, transitionName) as Options),
        ...(getValueTransition(typeTransition as never, transitionName) as Options),
      } as Options;
      options.duration = secondsToMilliseconds(options.duration ?? 0.3);
      options = applyGeneratorOptions(options as never) as Options;
      effect.updateTiming({
        delay: secondsToMilliseconds(options.delay ?? 0),
        duration: options.duration,
        easing: mapEasingToNativeEasing(options.ease as never, options.duration as number) as string,
      });
      layerAnimations.push(new NativeAnimationWrapper(viewAnimation as never));
    }
  }
  if (hasValues && hasMatching) {
    for (const [prop, value] of Object.entries(values)) {
      let keyframes = value as unknown;
      const options = {
        ...(getValueTransition(props.transition as never, prop) as Options),
        ...(getValueTransition(typeTransition as never, prop) as Options),
      } as Options;
      if (options.duration) options.duration = secondsToMilliseconds(options.duration);
      if (options.delay) options.delay = secondsToMilliseconds(options.delay);
      if (prop === 'opacity' && !Array.isArray(keyframes)) keyframes = [type === 'enter' ? 0 : 1, keyframes];
      layerAnimations.push(
        new NativeAnimation({
          ...options,
          element: document.documentElement,
          name: prop,
          pseudoElement: `::view-transition-${type === 'enter' ? 'new' : 'old'}(${name})`,
          keyframes,
        } as never),
      );
    }
  }
  const animation = new GroupAnimation(layerAnimations as never);
  return () => animation.cancel();
}

function AnimateView({ children, ...props }: AnimateViewProps) {
  useResetViewTransitions();
  const create =
    (type: Kind) =>
    ({ name }: { name: string }, types: string[]) =>
      animateLayers(name, type, props as AnimateViewProps, types);
  return (
    <ViewTransition update="none" share="none" onEnter={create('enter')} onExit={create('exit')}>
      {children}
    </ViewTransition>
  );
}

export { AnimateView, type AnimateViewProps };
