import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'

export async function GET(request: NextRequest) {
    const requestUrl = new URL(request.url)
    const origin = process.env.NEXT_PUBLIC_SITE_URL || requestUrl.origin
    const code = requestUrl.searchParams.get('code')
    // if "next" is in param, use it as the redirect URL
    const next = requestUrl.searchParams.get('next') ?? '/auth/confirmed'

    if (code) {
        // Create the redirect response first so we can attach cookies to it
        const response = NextResponse.redirect(`${origin}${next}`)
        const cookieStore = request.cookies

        const supabase = createServerClient(
            process.env.NEXT_PUBLIC_SUPABASE_URL!,
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
            {
                cookies: {
                    get(name: string) {
                        return cookieStore.get(name)?.value
                    },
                    set(name: string, value: string, options: CookieOptions) {
                        // Update both request (for consistency) and response (for browser)
                        cookieStore.set({ name, value, ...options })
                        response.cookies.set({ name, value, ...options })
                    },
                    remove(name: string, options: CookieOptions) {
                        cookieStore.delete(name)
                        response.cookies.delete(name)
                    },
                },
            }
        )
        const { error } = await supabase.auth.exchangeCodeForSession(code)
        if (!error) {
            return response
        }

        console.error('Auth error:', error)
        // Redirect to confirmed page but with error details
        const errorUrl = new URL(next, origin)
        errorUrl.searchParams.set('error', error.message)
        errorUrl.searchParams.set('code', error.code || 'unknown')
        return NextResponse.redirect(errorUrl)
    }

    // return the user to an error page with instructions
    const noCodeUrl = new URL(next, origin)
    noCodeUrl.searchParams.set('error', 'No auth code found')
    return NextResponse.redirect(noCodeUrl)
}
