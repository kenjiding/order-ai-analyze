/**
 * 区域包裹价格表（region_package_prices）的共享读取。
 *
 * 两个消费者：出仓派签达成分析的结算（按签收单算实收）、供应商区域地图（按到件量算理论利润）。
 * 两边必须读到同一份价格、用同一套撞价规则，否则同一片区在两个页面上算出两种钱。
 */
import { asc } from 'drizzle-orm'
import { getDb, schema } from './db'
import { priceBookKey, type PackagePrice } from './dispatch24hStats/aggregateCells'

const LABEL = '[region-package-prices]'

/**
 * 价格表拍平成「postcode|SUBURB → 价格」的内存 Map 供逐行查。
 *
 * **刻意不按州过滤**：region_package_prices.region_code 是「哪些账号能看见这行」的可见性字段，
 * 值取自当初导入者所属的州（见 regionPackagePriceRouter.resolveRegionCode），超管导的整批会是
 * 'system'。而计价问的是另一件事——「5000 / ADELAIDE 这个地方多少钱」，答案与谁能看见它无关。
 * 按州过滤会让金额取决于当初是谁登录导的表：站点配 SA、表是超管导的，就一行都查不到，
 * 整批包裹静默全额漏计。澳洲邮编本身按州分段（SA 5xxx / VIC 3xxx / NSW 2xxx），跨州撞不到
 * 同一个 postcode+suburb，去掉这层过滤不会引入误匹配。
 * 页面侧的按州隔离不受影响，仍由 regionPackagePriceRouter 自行过滤。
 *
 * 返回 undefined = 一条价格都没有；调用方会把全部包裹记入「未计价」，而不是静默按 0 元算。
 */
export async function loadPriceBook(): Promise<Map<string, PackagePrice> | undefined> {
  const rows = await getDb()
    .select({
      regionCode: schema.regionPackagePrices.regionCode,
      postcode: schema.regionPackagePrices.postcode,
      suburb: schema.regionPackagePrices.suburb,
      price: schema.regionPackagePrices.price,
      courierPrice: schema.regionPackagePrices.courierPrice,
    })
    .from(schema.regionPackagePrices)
    // 唯一索引是 (region_code, postcode, suburb)，同一地址可能在多个 region_code 下各存一行。
    // 定死顺序，使「撞价时哪行生效」在多次读取之间稳定，不会重跑一次金额就变
    .orderBy(
      asc(schema.regionPackagePrices.postcode),
      asc(schema.regionPackagePrices.suburb),
      asc(schema.regionPackagePrices.regionCode),
    )
  if (rows.length === 0) {
    console.warn(`${LABEL} 区域包裹价格表为空，本次计价的包裹将全部记为「未计价」`)
    return undefined
  }

  const book = new Map<string, PackagePrice>()
  const conflicts: string[] = []
  for (const row of rows) {
    const key = priceBookKey(row.postcode, row.suburb)
    const existing = book.get(key)
    if (existing) {
      // 同一地址两行价格不同 = 重复导入（如超管以 'system' 导过一份、州账号又导了改价版本）。
      // 取排序靠前的那行，但必须喊出来——静默挑一个等于随机给钱
      if (existing.price !== row.price || existing.courierPrice !== row.courierPrice) {
        conflicts.push(`${key}(region=${row.regionCode} ${row.price}/${row.courierPrice})`)
      }
      continue
    }
    book.set(key, { price: row.price, courierPrice: row.courierPrice })
  }
  if (conflicts.length > 0) {
    console.warn(
      `${LABEL} 区域包裹价格表有 ${conflicts.length} 处同地址异价，已取排序靠前的一行，请清理重复数据：` +
        conflicts.slice(0, 20).join(', ') +
        (conflicts.length > 20 ? ' …' : ''),
    )
  }
  return book
}
