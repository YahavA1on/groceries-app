export function replaceStateWhenChanged(setState, nextValue) {
  const nextSnapshot = JSON.stringify(nextValue)
  setState((currentValue) => (
    JSON.stringify(currentValue) === nextSnapshot ? currentValue : nextValue
  ))
}
