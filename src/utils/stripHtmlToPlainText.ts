/**
 * 去掉 HTML 标签，仅保留可见文本；例外：保留 `<important>...</important>` 标签本身
 * （含可选属性），其余标签全部删除（与 server/src/imile/track 逻辑保持一致）。
 */
export function stripHtmlToPlainText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, '')
    .replace(/<style\b[\s\S]*?<\/style>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '')
    .replace(/<(?!\/?important\b)[^>]*>/gi, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * 掩码轨迹中的电话号码（中澳常见写法，含国际区号与分隔符），避免外泄。
 * 与 server/src/imile/track.ts 内规则需保持同步。
 */
export function maskPhoneNumbersInText(text: string): string {
  if (!text) return text
  let s = text

  const cnMobile =
    /(?<![0-9])(?:\+?86(?:[-\s]|\u00b7|\u2022)*|0086(?:[-\s]|\u00b7|\u2022)*)?1[3-9](?:[-\s·•]?\d){9}(?![0-9])/g
  s = s.replace(cnMobile, '***')

  // 澳洲（须在中国大陆 0xx 固话之前，避免 04 手机号被误判）
  const auIntlMobile =
    /(?<![0-9])\+?61(?:[-\s·•]*)4(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auIntlMobile, '***')

  const auIDD61Mobile = /(?<![0-9])0061(?:[-\s·•]*)4(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auIDD61Mobile, '***')

  const auDomesticMobile = /(?<![0-9])04(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auDomesticMobile, '***')

  const auIntlLandline =
    /(?<![0-9])\+?61(?:[-\s·•]*)(?:2|3|7|8)(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auIntlLandline, '***')

  const auNatLandline =
    /(?<![0-9])0(?:[-\s·•]*)(?:2|3|7|8)(?:[-\s·•]*\d){8}(?![0-9])/g
  s = s.replace(auNatLandline, '***')

  const cnLandline = /(?<![0-9])0\d{2,3}[-\s·•]?\d{7,8}(?![0-9])/g
  s = s.replace(cnLandline, '***')

  const cnToll400800 = /(?<![0-9])[48]00[-\s·•]?\d{3}[-\s·•]?\d{4}(?![0-9])/g
  s = s.replace(cnToll400800, '***')

  return s
}

/**
 * 去掉轨迹里的「ID: xxx」「id：xxx」片段（半角/全角冒号），避免内部编号外泄。
 * 与 server/src/imile/track.ts 内规则需保持同步。
 */
export function stripIdColonLabels(text: string): string {
  if (!text) return text
  const re = /\b[Ii][Dd]\s*[:：]\s*[^\s，。；、）)\]\n\r]+/g
  return text.replace(re, '').replace(/\s{2,}/g, ' ').trim()
}

/** 轨迹字段入库/展示/传模型前：去掉除 `<important>` 外的 HTML + 掩码电话 + 去除 ID: 片段。 */
export function sanitizeTrackPlainText(html: string): string {
  const plain = stripHtmlToPlainText(html)
  const masked = maskPhoneNumbersInText(plain)
  return stripIdColonLabels(masked)
}
