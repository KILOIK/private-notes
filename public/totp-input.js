/** @param {unknown} value */
export function normalizeTotpInput(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 6);
}

/** @param {Array<{ focus?: () => void }>} inputs @param {number} index @param {-1 | 0 | 1} direction */
export function moveTotpFocus(inputs, index, direction) {
  const nextIndex = Math.max(0, Math.min(inputs.length - 1, index + direction));
  inputs[nextIndex]?.focus?.();
  return nextIndex;
}
