export const removeNulls = <T>(value: T | undefined): value is T => value != null;
