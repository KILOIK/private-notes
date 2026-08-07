export function createLatestOperation() {
  let current = 0;
  return Object.freeze({
    begin() {
      current += 1;
      return current;
    },
    /** @param {number} operationId */
    isCurrent(operationId) {
      return operationId === current;
    },
    cancel() {
      current += 1;
    }
  });
}
