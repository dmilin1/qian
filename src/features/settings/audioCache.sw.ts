// Workbox plugin callback for the service worker's audio route (vite.config.ts > runtimeCaching).
// generateSW serializes it with Function.prototype.toString, so it must stay self-contained:
// no imports, no outside references, no helper functions.

/**
 * `handlerWillRespond`: turn a 200 into a 206 slice when the page asked for a byte range.
 *
 * The route fetches whole clips on a miss (a 206 can't be cached) and RangeRequestsPlugin only
 * slices cache hits, so without this the first play of an uncached clip answers `<audio>`'s
 * "Range: bytes=0-1" probe with a full 200. iOS Safari's media loader may reject that and the app
 * would fall back to the browser voice. Cache hits arrive here as 206 already and pass through.
 * The cache put uses a clone, so reading the body here is safe. Mirrors workbox-range-requests'
 * createPartialResponse.
 */
export const audioRangeResponse = async ({ request, response }: { request: Request; response: Response }): Promise<Response> => {
  const range = request.headers.get('range')
  if (!range || response?.status !== 200) return response
  const m = /^bytes=(\d*)-(\d*)$/.exec(range.trim())
  if (!m || (m[1] === '' && m[2] === '')) return response
  const blob = await response.blob()
  const size = blob.size
  let start: number
  let end: number
  if (m[1] === '') {
    // Suffix range "bytes=-N": the last N bytes.
    start = Math.max(0, size - Number(m[2]))
    end = size - 1
  } else {
    start = Number(m[1])
    end = m[2] === '' ? size - 1 : Math.min(Number(m[2]), size - 1)
  }
  if (start >= size || start > end) {
    return new Response(null, { status: 416, statusText: 'Range Not Satisfiable', headers: { 'Content-Range': `bytes */${size}` } })
  }
  const slice = blob.slice(start, end + 1)
  return new Response(slice, {
    status: 206,
    statusText: 'Partial Content',
    headers: {
      'Content-Type': response.headers.get('content-type') || 'audio/mpeg',
      'Content-Range': `bytes ${start}-${end}/${size}`,
      'Content-Length': String(slice.size),
      'Accept-Ranges': 'bytes',
    },
  })
}
