export type GeofenceCoordinate = {
  latitude: number;
  longitude: number;
};

const MIN_CROSS_PRODUCT = 1e-12;

/**
 * Orders four boundary points around their shared center and rejects shapes
 * that cannot form a convex four-sided polygon.
 */
export function orderQuadrilateralPoints<T extends GeofenceCoordinate>(
  points: readonly T[],
): T[] | null {
  if (points.length !== 4) return null;

  const center = points.reduce(
    (sum, point) => ({
      latitude: sum.latitude + point.latitude / points.length,
      longitude: sum.longitude + point.longitude / points.length,
    }),
    { latitude: 0, longitude: 0 },
  );
  const longitudeScale = Math.max(
    0.01,
    Math.cos((center.latitude * Math.PI) / 180),
  );
  const ordered = [...points].sort((a, b) => {
    const angleA = Math.atan2(
      a.latitude - center.latitude,
      (a.longitude - center.longitude) * longitudeScale,
    );
    const angleB = Math.atan2(
      b.latitude - center.latitude,
      (b.longitude - center.longitude) * longitudeScale,
    );
    return angleA - angleB;
  });

  const crossProducts = ordered.map((point, index) => {
    const next = ordered[(index + 1) % ordered.length];
    const afterNext = ordered[(index + 2) % ordered.length];
    return (
      (next.longitude - point.longitude) *
        (afterNext.latitude - next.latitude) -
      (next.latitude - point.latitude) *
        (afterNext.longitude - next.longitude)
    );
  });
  if (crossProducts.some(value => Math.abs(value) <= MIN_CROSS_PRODUCT)) {
    return null;
  }

  const hasClockwiseTurn = crossProducts.some(value => value < 0);
  const hasCounterClockwiseTurn = crossProducts.some(value => value > 0);
  if (hasClockwiseTurn && hasCounterClockwiseTurn) {
    return null;
  }

  return ordered;
}
