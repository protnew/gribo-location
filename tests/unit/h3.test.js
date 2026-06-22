import { describe, it, expect } from 'vitest';
import { latLngToCell, cellToBoundary } from 'h3-js';

describe('H3 Geospatial Grid Logic', () => {
  it('should convert coordinate to an H3 index (resolution 9)', () => {
    const lat = 53.900;
    const lng = 27.566; // Minsk
    const hexId = latLngToCell(lat, lng, 9);
    
    expect(hexId).toBeTruthy();
    expect(typeof hexId).toBe('string');
    // Resolution 9 H3 indexes usually have 15 characters
    expect(hexId.length).toBe(15);
  });

  it('should return 6 boundary vertices for a valid H3 cell', () => {
    const hexId = '89118544c03ffff'; // Example H3 cell (Resolution 9)
    const boundary = cellToBoundary(hexId);
    
    expect(boundary).toBeInstanceOf(Array);
    expect(boundary.length).toBe(6);
    // Each vertex should be [lat, lng]
    expect(boundary[0].length).toBe(2);
    expect(typeof boundary[0][0]).toBe('number');
  });

  it('should group nearby points into the same hexagon', () => {
    // Points very close to each other
    const hex1 = latLngToCell(53.9001, 27.5661, 8);
    const hex2 = latLngToCell(53.9002, 27.5662, 8);
    
    expect(hex1).toBe(hex2);
  });
});
