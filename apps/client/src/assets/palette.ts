/**
 * Color palettes and tokens for procedural world generation.
 * Deep navy/indigo base, neon cyan, magenta, and amber with strong value contrast.
 */

export interface DistrictPalette {
  id: string;
  name: string;
  voidColor: string;
  asphalt: {
    base: string;
    dark: string;
    light: string;
    cracked: string;
    puddle: string;
    grate: string;
  };
  sidewalk: {
    base: string;
    curb: string;
    edge: string;
  };
  plaza: {
    base: string;
    accent: string;
    tileEdge: string;
  };
  roadMarkings: {
    white: string;
    yellow: string;
  };
  wallRoof: {
    base: string;
    trim: string;
    shadow: string;
    equipment: string;
    antenna: string;
  };
  wallFacade: {
    base: string;
    panel: string;
    trim: string;
    unlitWindow: string;
    litWindows: readonly string[];
    door: string;
    awning: string;
  };
  neon: {
    primary: string;
    secondary: string;
    accent: string;
  };
  signStyle: {
    fontColor: string;
    borderColor: string;
    glowColor: string;
  };
}

export const DEFAULT_PALETTE: DistrictPalette = {
  id: 'downtown',
  name: 'Downtown Core',
  voidColor: '#020408',
  asphalt: {
    base: '#1a233a',
    dark: '#121828',
    light: '#253250',
    cracked: '#0c101c',
    puddle: '#0e3654',
    grate: '#3b4861',
  },
  sidewalk: {
    base: '#364566',
    curb: '#506594',
    edge: '#1a2233',
  },
  plaza: {
    base: '#243352',
    accent: '#334770',
    tileEdge: '#162033',
  },
  roadMarkings: {
    white: '#e2e8f0',
    yellow: '#fbbf24',
  },
  wallRoof: {
    base: '#1c2742',
    trim: '#3b4f7a',
    shadow: '#0a0f1d',
    equipment: '#425888',
    antenna: '#38bdf8',
  },
  wallFacade: {
    base: '#182238',
    panel: '#222f4d',
    trim: '#00f0ff',
    unlitWindow: '#0e1424',
    litWindows: ['#00f0ff', '#fbbf24', '#f43f5e', '#38bdf8'],
    door: '#2a3b5c',
    awning: '#0284c7',
  },
  neon: {
    primary: '#00f0ff',
    secondary: '#f43f5e',
    accent: '#fbbf24',
  },
  signStyle: {
    fontColor: '#00f0ff',
    borderColor: '#0284c7',
    glowColor: 'rgba(0, 240, 255, 0.6)',
  },
};

export const DISTRICT_PALETTES: Record<string, DistrictPalette> = {
  tech_quarter: {
    ...DEFAULT_PALETTE,
    id: 'tech_quarter',
    name: 'Tech Quarter',
    asphalt: { ...DEFAULT_PALETTE.asphalt, base: '#16223d', light: '#223359' },
    sidewalk: { base: '#2d4269', curb: '#446299', edge: '#141e30' },
    plaza: { base: '#223554', accent: '#304b78', tileEdge: '#131e30' },
    neon: { primary: '#00f0ff', secondary: '#38bdf8', accent: '#a855f7' },
    signStyle: { fontColor: '#00f0ff', borderColor: '#38bdf8', glowColor: 'rgba(0, 240, 255, 0.7)' },
  },
  data_harbor: {
    ...DEFAULT_PALETTE,
    id: 'data_harbor',
    name: 'Data Harbor',
    asphalt: { ...DEFAULT_PALETTE.asphalt, base: '#142533', light: '#1d364a', puddle: '#0e4663' },
    sidewalk: { base: '#28465c', curb: '#3b6787', edge: '#11202b' },
    plaza: { base: '#1f384a', accent: '#2d526b', tileEdge: '#101e26' },
    neon: { primary: '#06b6d4', secondary: '#10b981', accent: '#38bdf8' },
    signStyle: { fontColor: '#06b6d4', borderColor: '#0891b2', glowColor: 'rgba(6, 182, 212, 0.7)' },
  },
  central_exchange: {
    ...DEFAULT_PALETTE,
    id: 'central_exchange',
    name: 'Central Exchange',
    asphalt: { ...DEFAULT_PALETTE.asphalt, base: '#202433', light: '#2f354a' },
    sidewalk: { base: '#3a4259', curb: '#545f80', edge: '#1b1f2b' },
    plaza: { base: '#2e3547', accent: '#424c66', tileEdge: '#191d26' },
    neon: { primary: '#f59e0b', secondary: '#fbbf24', accent: '#00f0ff' },
    signStyle: { fontColor: '#fbbf24', borderColor: '#d97706', glowColor: 'rgba(251, 191, 36, 0.7)' },
  },
  black_grid: {
    ...DEFAULT_PALETTE,
    id: 'black_grid',
    name: 'Black Grid',
    asphalt: { ...DEFAULT_PALETTE.asphalt, base: '#151721', light: '#222533' },
    sidewalk: { base: '#282b3b', curb: '#3d4157', edge: '#11121a' },
    plaza: { base: '#1f222e', accent: '#303447', tileEdge: '#0f1017' },
    neon: { primary: '#ef4444', secondary: '#f97316', accent: '#dc2626' },
    signStyle: { fontColor: '#ef4444', borderColor: '#b91c1c', glowColor: 'rgba(239, 68, 68, 0.7)' },
  },
  undercity: {
    ...DEFAULT_PALETTE,
    id: 'undercity',
    name: 'Undercity',
    asphalt: { ...DEFAULT_PALETTE.asphalt, base: '#1c1729', light: '#2a233d', puddle: '#4c1d95' },
    sidewalk: { base: '#352b4d', curb: '#4e3f70', edge: '#161221' },
    plaza: { base: '#2b233e', accent: '#3e3259', tileEdge: '#14101c' },
    neon: { primary: '#c084fc', secondary: '#ec4899', accent: '#06b6d4' },
    signStyle: { fontColor: '#ec4899', borderColor: '#c026d3', glowColor: 'rgba(236, 72, 153, 0.7)' },
  },
  nexus: {
    ...DEFAULT_PALETTE,
    id: 'nexus',
    name: 'The NEXUS',
    asphalt: { ...DEFAULT_PALETTE.asphalt, base: '#1c1b3b', light: '#2a2857' },
    sidewalk: { base: '#38356b', curb: '#504b99', edge: '#16152b' },
    plaza: { base: '#2c2a54', accent: '#403d78', tileEdge: '#141326' },
    neon: { primary: '#00f0ff', secondary: '#f43f5e', accent: '#eab308' },
    signStyle: { fontColor: '#ffffff', borderColor: '#00f0ff', glowColor: 'rgba(0, 240, 255, 0.8)' },
  },
};
