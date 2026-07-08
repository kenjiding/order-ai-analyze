import { Router } from 'express'
import { requireAuth } from '../auth/middleware'
import { getCurrentUser, loginUser, logoutUser } from '../services/authService'

export const authRouter = Router()

authRouter.post('/login', (req, res) => {
  void loginUser(req, res, String(req.body?.username ?? ''), String(req.body?.password ?? ''))
})

authRouter.post('/logout', (req, res) => {
  logoutUser(req, res)
})

authRouter.get('/me', requireAuth, (req, res) => {
  void getCurrentUser(req, res)
})
