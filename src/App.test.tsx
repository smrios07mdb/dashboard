import { render, screen } from '@testing-library/react'
import App from './App'

/*
 * Chunk 78: the signed-in case swaps the layout route for a bare `<Outlet />`
 * and the Dashboard for a marker, so the route table is what's under test.
 * Signed out, the real layout renders (and shows Login).
 */
const { authed } = vi.hoisted(() => ({ authed: { value: false } }))

vi.mock('@/components/ProtectedLayout', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/components/ProtectedLayout')>()
  const { Outlet } = await import('react-router-dom')
  const Real = actual.default
  return { default: () => (authed.value ? <Outlet /> : <Real />) }
})

vi.mock('@/screens/Dashboard', () => ({
  default: () => <h1>Dashboard screen</h1>,
}))

describe('App', () => {
  const initialPath = window.location.pathname

  afterEach(() => {
    authed.value = false
    window.history.replaceState({}, '', initialPath)
  })

  it('renders the Login screen when no session is present', async () => {
    render(<App />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeInTheDocument()
  })

  it('sends a signed-in visit to /routines to the Dashboard (chunk 78)', async () => {
    authed.value = true
    window.history.pushState({}, '', `${import.meta.env.BASE_URL}routines`)
    render(<App />)
    expect(
      await screen.findByRole('heading', { name: 'Dashboard screen' }),
    ).toBeInTheDocument()
    expect(window.location.pathname).toBe(import.meta.env.BASE_URL)
  })
})
