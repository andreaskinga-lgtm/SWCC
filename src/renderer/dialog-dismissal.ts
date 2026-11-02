import { useRef } from 'react';
import type { MouseEvent, PointerEvent } from 'react';

interface BackdropPointer {
  id: number;
  pressedOnBackdrop: boolean;
  releasedOnBackdrop: boolean;
}

export function useDialogBackdropDismiss(onDismiss: () => void) {
  const pointer = useRef<BackdropPointer | null>(null);

  function onPointerDown(event: PointerEvent<HTMLDialogElement>) {
    pointer.current = event.isPrimary && event.button === 0
      ? {
          id: event.pointerId,
          pressedOnBackdrop: event.target === event.currentTarget,
          releasedOnBackdrop: false,
        }
      : null;
  }

  function onPointerUp(event: PointerEvent<HTMLDialogElement>) {
    if (pointer.current?.id === event.pointerId) {
      pointer.current.releasedOnBackdrop = event.target === event.currentTarget;
    }
  }

  function onPointerCancel(event: PointerEvent<HTMLDialogElement>) {
    if (pointer.current?.id === event.pointerId) pointer.current = null;
  }

  function onClick(event: MouseEvent<HTMLDialogElement>) {
    const clickedBackdrop = event.target === event.currentTarget;
    const pressedAndReleasedOnBackdrop = pointer.current?.pressedOnBackdrop && pointer.current.releasedOnBackdrop;
    pointer.current = null;
    if (clickedBackdrop && pressedAndReleasedOnBackdrop && event.detail > 0) onDismiss();
  }

  return { onPointerDown, onPointerUp, onPointerCancel, onClick };
}
