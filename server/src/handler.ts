import serverless from 'serverless-http'
import { app } from './app'

// Lambda 环境变量由 SST 在部署时直接注入，无需读取 .env 文件
export const handler = serverless(app)
