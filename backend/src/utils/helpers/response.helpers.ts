export function successResponse<T>(message: string, data: T) {
  return { success: true as const, message, data };
}
