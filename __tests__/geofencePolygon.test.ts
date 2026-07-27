import { orderQuadrilateralPoints } from '../src/utils/geofencePolygon';

describe('orderQuadrilateralPoints', () => {
  test('orders crossed tap input into a clean four-sided boundary', () => {
    const topLeft = { latitude: 13, longitude: 77 };
    const bottomRight = { latitude: 12, longitude: 78 };
    const topRight = { latitude: 13, longitude: 78 };
    const bottomLeft = { latitude: 12, longitude: 77 };

    expect(orderQuadrilateralPoints([
      topLeft,
      bottomRight,
      topRight,
      bottomLeft,
    ])).toEqual([
      bottomLeft,
      bottomRight,
      topRight,
      topLeft,
    ]);
  });

  test('does not create a polygon with fewer than four markers', () => {
    expect(orderQuadrilateralPoints([
      { latitude: 13, longitude: 77 },
      { latitude: 12, longitude: 78 },
      { latitude: 13, longitude: 78 },
    ])).toBeNull();
  });

  test('rejects four points that do not create four outside corners', () => {
    expect(orderQuadrilateralPoints([
      { latitude: 12, longitude: 77 },
      { latitude: 12, longitude: 79 },
      { latitude: 14, longitude: 77 },
      { latitude: 12.5, longitude: 77.5 },
    ])).toBeNull();
  });
});
