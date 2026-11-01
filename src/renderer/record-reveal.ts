import type { AnimationEvent } from 'react';

export function isRecordRevealAnimationEnd(event: AnimationEvent<HTMLElement>) {
  return event.target === event.currentTarget && event.animationName === 'swcc-record-reveal';
}
