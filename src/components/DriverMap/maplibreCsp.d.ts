/** CSP 安全构建（不内嵌 blob worker），生产打包成一个大 chunk 时默认构建会因 worker 自解析崩溃出 "X is not defined" */
declare module 'maplibre-gl/dist/maplibre-gl-csp' {
  export * from 'maplibre-gl'
  export { default } from 'maplibre-gl'
}
