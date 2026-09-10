const demos = [
  { id: -1, title: 'Toast Panic', description: 'Wait… wait… CATCH! Save your breakfast in a five-second reaction challenge.' },
  { id: -2, title: 'Odd Duck', description: 'Spot the sunglasses duck three times in six seconds. One wrong pick and you’re toast.' },
]

// Originals follow the final community page, so publishing never removes them.
export function feedPage(data) {
  return data.next ? data.games : [...data.games, ...demos];
}
