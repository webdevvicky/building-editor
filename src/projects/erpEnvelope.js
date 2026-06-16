// ERP API envelope unwrapper — single source of truth for response format.
// All ERP endpoints wrap responses in { success, data, error, meta },
// but non-envelope responses (e.g. static files) may be raw.

/**
 * Unwrap an ERP API response envelope. If the response has a valid envelope
 * structure (success + data fields), returns the data; otherwise returns the
 * response itself as a fallback.
 *
 * @param {any} json — parsed response from ERP API
 * @returns {any} the unwrapped data or the response itself
 */
export function unwrapErpResponse(json) {
  if (json?.success && json?.data !== undefined) {
    return json.data
  }
  return json
}
