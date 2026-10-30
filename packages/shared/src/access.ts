export type AccountRole = 'player' | 'admin' | 'superadmin';
export const isStaff = (role?: AccountRole) => role === 'admin' || role === 'superadmin';
