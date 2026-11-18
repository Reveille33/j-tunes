/** True when a page response still belongs to the request that started it. */
export function isCurrentEpisodePage(
  startedRequest: number,
  currentRequest: number,
  startedLoad: number,
  currentLoad: number
): boolean {
  return startedRequest === currentRequest && startedLoad === currentLoad
}
