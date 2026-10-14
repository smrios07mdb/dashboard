/*
 * The working day, in minutes since midnight (chunk 87). Shared by the
 * Planner's capacity window (`PLANNER.workStart` / `workEnd`) and Today's free
 * time (`lib/freeToday`). Its own module so the eager bundle can read it
 * without pulling in `plannerGeometry`, which the lazy Planner chunk shares.
 */
export const WORK_START_MIN = 9 * 60
export const WORK_END_MIN = 18 * 60
