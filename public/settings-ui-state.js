/**
 * @param {boolean} open
 * @returns {{ open: boolean, ariaHidden: boolean, backgroundInert: boolean, scrollLocked: boolean }}
 */
export function getSettingsSurfaceState(open) {
  return {
    open,
    ariaHidden: !open,
    backgroundInert: open,
    scrollLocked: open,
  };
}
