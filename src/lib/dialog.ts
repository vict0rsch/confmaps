import type { Attachment } from 'svelte/attachments';

/**
 * Closes a modal <dialog> on a tap outside its box, on its backdrop (DESIGN §6.7). The press must
 * start there too: a drag from inside (selecting text in a field) that ends outside keeps it open.
 * A tap on the dialog's own padding is inside its box. A dialog opened inside another (Share in the
 * logo panel) closes alone: the outer dialog sees the event with the inner one as its target.
 */
export const lightDismiss: Attachment<HTMLDialogElement> = (dialog) => {
  let fromBackdrop = false;
  const outside = (e: MouseEvent) => {
    if (e.target !== dialog) return false;
    const r = dialog.getBoundingClientRect();
    return e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
  };
  const down = (e: PointerEvent) => {
    fromBackdrop = outside(e);
  };
  const click = (e: MouseEvent) => {
    if (fromBackdrop && outside(e)) dialog.close();
    fromBackdrop = false;
  };
  dialog.addEventListener('pointerdown', down);
  dialog.addEventListener('click', click);
  return () => {
    dialog.removeEventListener('pointerdown', down);
    dialog.removeEventListener('click', click);
  };
};
