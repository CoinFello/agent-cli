import { CookieJar } from 'tough-cookie'

export const cookieJar = new CookieJar()

export async function fetchWithCookies(url: string, init?: RequestInit): Promise<Response> {
  const cookieString = await cookieJar.getCookieString(url)
  const headers = new Headers(init?.headers as HeadersInit)
  if (cookieString) {
    headers.set('Cookie', cookieString)
  }
  headers.forEach((val) => console.log('header ', val))
  console.log('url ', url, 'headers ')

  const response = await fetch(url, { ...init, headers })

  for (const cookie of response.headers.getSetCookie()) {
    console.log('adding this cookie ', cookie)
    await cookieJar.setCookie(cookie, url)
  }

  return response
}

export async function loadSessionToken(token: string, url: string): Promise<void> {
  await cookieJar.setCookie(`better-auth.session_token=${token}`, url)
  await cookieJar.setCookie(`logged_in=true`, url)
}
