/** Grid caps for S03 decode/validate. Performance targets in spec 9.1 are separate. */
export const MIN_GRID_SIZE = 1;
export const MAX_GRID_WIDTH = 256;
export const MAX_GRID_HEIGHT = 256;
export const MAX_CELL_COUNT = MAX_GRID_WIDTH * MAX_GRID_HEIGHT;
export const EMPTY_CELL = -1 as const;
export const SCHEMA_VERSION_V1 = "1.0" as const;
