import { useState } from 'react'
import { login } from '../lib/auth'

export default function LoginScreen({ onLogin }) {
  const [username, setUsername] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e) => {
    e.preventDefault()
    if (!username.trim()) return
    setLoading(true)
    setError('')
    const result = await login(username.trim())
    setLoading(false)
    if (result.error) setError(result.error)
    else onLogin(result.session)
  }

  return (
    <div className="login-screen">
      <div className="login-card">
        <h1>🛒 Groceries</h1>
        <form onSubmit={handleSubmit}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
          />
          <button type="submit" disabled={loading || !username.trim()}>
            {loading ? 'טוען...' : 'כניסה'}
          </button>
          {error && <div className="error">{error}</div>}
        </form>
      </div>
    </div>
  )
}