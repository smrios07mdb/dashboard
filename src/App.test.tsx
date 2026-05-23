import { render, screen } from '@testing-library/react'
import App from './App'

describe('App', () => {
  it('renders the Login screen when no session is present', async () => {
    render(<App />)
    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sign in' }),
    ).toBeInTheDocument()
  })
})
