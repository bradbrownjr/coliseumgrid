// Reading and writing cookies by hand, so the server needs no cookie package. Only the parts
// this app uses: a Cookie header to read, and a Set-Cookie header with the fixed attributes
// from docs/PLAN.md ("Sessions"): Path=/, HttpOnly, SameSite=Strict, and Secure over HTTPS.
// Syntax: RFC 6265, https://www.rfc-editor.org/rfc/rfc6265#section-4.1.1

// token = 1*<any CHAR except CTLs or separators> (RFC 6265 section 4.1.1, via RFC 2616).
const NAME_PATTERN = /^[!#$%&'*+.^_`|~0-9A-Za-z-]+$/;
// cookie-octet: printable ASCII except space, double quote, comma, semicolon, and backslash.
const VALUE_PATTERN = /^[\x21\x23-\x2B\x2D-\x3A\x3C-\x5B\x5D-\x7E]*$/;

/**
 * The cookies in a Cookie header: every value of each name, in the order sent. A name can
 * appear more than once, and another page of the same site can add a cookie of ours with a
 * narrower Path, which browsers list first. The caller decides which value is real; taking
 * the first would let that page shadow the real cookie.
 */
export function parseCookies(header: string | undefined): Map<string, string[]> {
  const cookies = new Map<string, string[]>();
  if (!header) return cookies;
  for (const part of header.split(';')) {
    const equals = part.indexOf('=');
    if (equals < 0) continue;
    const name = part.slice(0, equals).trim();
    let value = part.slice(equals + 1).trim();
    if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    if (name) cookies.set(name, [...(cookies.get(name) ?? []), value]);
  }
  return cookies;
}

export interface CookieOptions {
  /** Whole seconds. 0 makes the browser delete the cookie. */
  maxAgeSeconds: number;
  secure: boolean;
}

/**
 * A Set-Cookie header value. Throws on a name or value that could break the header, so a
 * future caller can't inject an attribute through either.
 */
export function serializeCookie(name: string, value: string, options: CookieOptions): string {
  if (!NAME_PATTERN.test(name)) throw new TypeError('invalid cookie name');
  if (!VALUE_PATTERN.test(value)) throw new TypeError('invalid cookie value');
  if (!Number.isSafeInteger(options.maxAgeSeconds) || options.maxAgeSeconds < 0) {
    throw new RangeError('maxAgeSeconds must be a whole number of seconds, 0 or more');
  }
  const parts = [`${name}=${value}`, 'Path=/', `Max-Age=${options.maxAgeSeconds}`, 'HttpOnly', 'SameSite=Strict'];
  if (options.secure) parts.push('Secure');
  return parts.join('; ');
}
