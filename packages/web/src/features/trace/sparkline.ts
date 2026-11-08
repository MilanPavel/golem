const round = (value: number): string => String(Math.round(value * 10) / 10);

/** The `points` of a polyline that draws `values` left to right, the highest at the top. */
export function sparkPoints(values: readonly number[], width: number, height: number, pad = 1): string {
  const count = values.length;
  const max = Math.max(...values) || 1;
  return values
    .map((value, i) => {
      const x = count === 1 ? pad : pad + (i / (count - 1)) * (width - 2 * pad);
      const y = height - pad - (value / max) * (height - 2 * pad);
      return `${round(x)},${round(y)}`;
    })
    .join(" ");
}
