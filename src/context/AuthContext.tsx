import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react'
import { fetchAuthMe, fetchLogin, fetchLogout, type AuthSession, type AuthUser } from '../api/authApi'

type AuthContextValue = {
  user: AuthUser | null
  permissions: string[]
  loading: boolean
  isAuthenticated: boolean
  isSuperAdmin: boolean
  login: (username: string, password: string) => Promise<AuthSession>
  logout: () => Promise<void>
  refreshMe: () => Promise<void>
  hasPermission: (key: string) => boolean
}

const AuthContext = createContext<AuthContextValue | null>(null)

function applySession(session: AuthSession | null) {
  return {
    user: session?.user ?? null,
    permissions: session?.permissions ?? [],
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null)
  const [permissions, setPermissions] = useState<string[]>([])
  const [loading, setLoading] = useState(true)

  const refreshMe = useCallback(async () => {
    const session = await fetchAuthMe()
    const next = applySession(session)
    setUser(next.user)
    setPermissions(next.permissions)
  }, [])

  useEffect(() => {
    void refreshMe().finally(() => setLoading(false))
  }, [refreshMe])

  const login = useCallback(async (username: string, password: string) => {
    const session = await fetchLogin(username, password)
    const next = applySession(session)
    setUser(next.user)
    setPermissions(next.permissions)
    return session
  }, [])

  const logout = useCallback(async () => {
    await fetchLogout()
    setUser(null)
    setPermissions([])
  }, [])

  const isSuperAdmin = user?.role === 'super_admin'

  const hasPermission = useCallback(
    (key: string) => {
      if (isSuperAdmin) return true
      return permissions.includes(key)
    },
    [isSuperAdmin, permissions],
  )

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      permissions,
      loading,
      isAuthenticated: Boolean(user),
      isSuperAdmin,
      login,
      logout,
      refreshMe,
      hasPermission,
    }),
    [user, permissions, loading, isSuperAdmin, login, logout, refreshMe, hasPermission],
  )

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within AuthProvider')
  }
  return ctx
}
