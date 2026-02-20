import { CookieJar } from 'tough-cookie'

export const cookieJar = new CookieJar()

export async function fetchWithCookies(url: string, init?: RequestInit): Promise<Response> {
  const cookieString = await cookieJar.getCookieString(url)
  const headers = new Headers(init?.headers as HeadersInit)
  if (cookieString) {
    headers.set('Cookie', cookieString)
  }

  const response = await fetch(url, { ...init, headers })

  for (const cookie of response.headers.getSetCookie()) {
    await cookieJar.setCookie(cookie, url)
  }

  return response
}

export async function loadSessionToken(token: string, url: string): Promise<void> {
  await cookieJar.setCookie(`better-auth.session_token=${token}`, url)
  await cookieJar.setCookie(`logged_in=true`, url)
}
