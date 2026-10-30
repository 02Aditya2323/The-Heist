/**
 * District loader and spatial lookup.
 * Assigns palettes and district metadata based on tile coordinates.
 */

import districtsJson from './districts.json';
import {
  DEFAULT_PALETTE,
  DISTRICT_PALETTES,
  type DistrictPalette,
} from '../assets/palette.js';

export interface DistrictBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DistrictDefinition {
  id: string;
  name: string;
  description: string;
  bounds: DistrictBounds;
  palette: DistrictPalette;
}

export class DistrictManager {
  private districts: DistrictDefinition[] = [];

  constructor() {
    this.loadDistricts();
  }

  private loadDistricts(): void {
    const rawList = districtsJson?.districts;
    if (Array.isArray(rawList)) {
      this.districts = rawList.map((d) => ({
        id: d.id,
        name: d.name,
        description: d.description || '',
        bounds: d.bounds,
        palette: DISTRICT_PALETTES[d.id] ?? DEFAULT_PALETTE,
      }));
    } else {
      this.districts = [];
    }
  }

  getDistrictAt(tileX: number, tileY: number): DistrictDefinition | null {
    for (const d of this.districts) {
      if (
        tileX >= d.bounds.minX &&
        tileX < d.bounds.maxX &&
        tileY >= d.bounds.minY &&
        tileY < d.bounds.maxY
      ) {
        return d;
      }
    }
    return null;
  }

  getPaletteAt(tileX: number, tileY: number): DistrictPalette {
    const d = this.getDistrictAt(tileX, tileY);
    return d ? d.palette : DEFAULT_PALETTE;
  }

  getAllDistricts(): readonly DistrictDefinition[] {
    return this.districts;
  }
}

export const globalDistricts = new DistrictManager();
