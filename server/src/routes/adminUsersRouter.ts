import { Router } from 'express'
import { requireAuth, requireSuperAdmin } from '../auth/middleware'
import {
  createUser,
  deleteUser,
  listAssignableRegions,
  listPermissions,
  listUsers,
  updateUser,
  updateUserPermissions,
} from '../services/userService'

export const adminUsersRouter = Router()

adminUsersRouter.use(requireAuth, requireSuperAdmin)

adminUsersRouter.get('/', (req, res) => {
  void listUsers(req, res)
})

adminUsersRouter.get('/regions', (req, res) => {
  void listAssignableRegions(req, res)
})

adminUsersRouter.get('/permissions', (req, res) => {
  void listPermissions(req, res)
})

adminUsersRouter.post('/', (req, res) => {
  void createUser(req, res)
})

adminUsersRouter.put('/:id', (req, res) => {
  void updateUser(req, res)
})

adminUsersRouter.delete('/:id', (req, res) => {
  void deleteUser(req, res)
})

adminUsersRouter.put('/:id/permissions', (req, res) => {
  void updateUserPermissions(req, res)
})
