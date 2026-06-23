import { create } from 'zustand'
import { fetchAuthMe, fetchLogin, fetchLogout, type AuthSession, type AuthUser } from '../api/authApi'

function applySession(session: AuthSession | null) {
  return {
    user: session?.user ?? null,
    permissions: session?.permissions ?? [],
  }
}

type AuthStore = {
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

export const useAuthStore = create<AuthStore>((set, get) => ({
  user: null,
  permissions: [],
  loading: true,
  isAuthenticated: false,
  isSuperAdmin: false,

  refreshMe: async () => {
    try {
      const session = await fetchAuthMe()
      const { user, permissions } = applySession(session)
      set({
        user,
        permissions,
        loading: false,
        isAuthenticated: Boolean(user),
        isSuperAdmin: user?.role === 'super_admin',
      })
    } catch {
      set({ loading: false })
    }
  },

  login: async (username, password) => {
    const session = await fetchLogin(username, password)
    const { user, permissions } = applySession(session)
    set({
      user,
      permissions,
      isAuthenticated: Boolean(user),
      isSuperAdmin: user?.role === 'super_admin',
    })
    return session
  },

  logout: async () => {
    await fetchLogout()
    set({ user: null, permissions: [], isAuthenticated: false, isSuperAdmin: false })
  },

  hasPermission: (key: string) => {
    const { isSuperAdmin, permissions } = get()
    if (isSuperAdmin) return true
    return permissions.includes(key)
  },
}))
