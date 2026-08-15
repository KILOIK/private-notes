/** @param {unknown} value */
export function normalizeTotpInput(value) {
  return String(value ?? '').replace(/\D/g, '').slice(0, 6);
}

/** @param {Array<{ value?: unknown }>} inputs @param {number} startIndex @param {unknown} value */
export function applyTotpInput(inputs, startIndex, value) {
  const digits = normalizeTotpInput(value);
  if (!Array.isArray(inputs) || inputs.length === 0) return '';
  const start = Math.max(0, Math.min(inputs.length - 1, Math.floor(startIndex)));
  if (!digits) {
    if (inputs[start]) inputs[start].value = '';
    return '';
  }
  for (let offset = 0; offset < digits.length && start + offset < inputs.length; offset += 1) {
    inputs[start + offset].value = digits[offset];
  }
  return digits.slice(0, inputs.length - start);
}

/** @param {Array<{ value?: unknown }>} inputs */
export function getCompleteTotpCode(inputs) {
  if (!Array.isArray(inputs) || inputs.length !== 6) return null;
  const values = inputs.map(function (input) { return String(input?.value ?? ''); });
  return values.every(function (value) { return /^\d$/.test(value); }) ? values.join('') : null;
}

/** @param {Array<{ focus?: () => void }>} inputs @param {number} index @param {-1 | 0 | 1} direction */
export function moveTotpFocus(inputs, index, direction) {
  const nextIndex = Math.max(0, Math.min(inputs.length - 1, index + direction));
  inputs[nextIndex]?.focus?.();
  return nextIndex;
}
