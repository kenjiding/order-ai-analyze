import type { WarehouseConfigDto } from './types'

/** 须与 server/src/orderAnalyze/warehouseConfig.ts 的 DEFAULT_WAREHOUSE_CONFIG 保持同步 */
export const DEFAULT_WAREHOUSE_CONFIG: WarehouseConfigDto = {
  global: {
    defaultLossTimeoutDays: 15,
    externalCarrierLossTimeoutDays: 15,
    merchantReturnTimeoutDays: 3,
    commonSystemOperators: ['System', 'cornerstone'],
    commonNonRealOperators: ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'],
    commonNonRealOperatorPatterns: ['^[A-Z]{2,5}\\s+OPS\\d+$'],
  },
  profiles: [
    {
      cityId: 'ADL',
      hubId: 'adelaide_center',
      name: 'Adelaide Center',
      extraAliases: ['adeliade center', 'Adelaide Centre', 'ADL Center', 'ADL Centre'],
      nonRealOperators: ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'],
      systemOperators: ['ADL OP1'],
    },
    {
      cityId: 'ADL',
      hubId: 'adelaide_ds',
      name: 'Adelaide DS',
      extraAliases: ['adelaide DS', 'ADL DS'],
      nonRealOperators: ['ADL-DC-Unload', 'Kuangyi Gao', 'Leeki', 'sorter', 'ADL OP1'],
      systemOperators: ['ADL OP1'],
    },
    {
      cityId: 'MEL',
      hubId: 'melbourne_center',
      name: 'Melbourne Center',
      extraAliases: ['Melbourne Centre', 'MEL Center', 'MEL Centre'],
    },
    {
      cityId: 'MEL',
      hubId: 'Mel South East',
      name: 'Mel South East',
      extraAliases: ['MEL DS'],
    },
    {
      cityId: 'QLD',
      hubId: 'Townsville Station',
      name: 'Townsville Station',
      systemOperators: ['Townsville Station'],
    },
    {
      cityId: 'CBR',
      hubId: 'canberra_station',
      name: 'Canberra Station',
      extraAliases: ['Canberra station'],
    },
    {
      cityId: 'QLD',
      hubId: 'gold_coast_station',
      name: 'Gold Coast Station',
      extraAliases: ['Gold Coast station'],
    },
    {
      cityId: 'QLD',
      hubId: 'sunshine_coast_station',
      name: 'Sunshine Coast Station',
      extraAliases: ['Sunshine Coast station'],
    },
    {
      cityId: 'SYD',
      hubId: 'newcastle_2',
      name: 'Newcastle-2',
      extraAliases: ['Newcastle 2', 'Newcasle-2'],
    },
    {
      cityId: 'PER',
      hubId: 'perth_placeholder',
      name: 'Perth Center',
      extraAliases: ['Perth Centre', 'Perth DS', 'PER Center', 'PER DS', 'Perth'],
      nonRealOperators: [
        'PER OPS1',
        'PER OPS2',
        'PER OPS3',
        'PER OPS4',
        'PER OPS5',
        'PER OPS6',
        'PER OPS7',
        'PER OPS8',
        'PER OPS9',
        'PER OPS10',
      ],
    },
    {
      cityId: 'SYD',
      hubId: 'sydney_placeholder',
      name: 'Sydney Center',
      extraAliases: ['Sydney Centre', 'Sydney DS', 'SYD Center', 'SYD DS', 'Sydney'],
    },
    {
      cityId: 'SYD',
      hubId: 'SYDN',
      name: 'SYDN',
      nonRealOperators: [
        'SYDN OPS1',
        'SYDN OPS2',
        'SYDN OPS3',
        'SYDN OPS4',
        'SYDN OPS5',
        'SYDN OPS6',
        'SYDN OPS7',
        'SYDN OPS8',
        'SYDN OPS9',
        'SYDN OPS10',
      ],
      lossTimeoutDays: 7,
    },
    {
      cityId: 'SYD',
      hubId: 'SYDE',
      name: 'SYDE',
      extraAliases: ['Sydney East', 'Sydney East DS', 'SYDE DS'],
      nonRealOperators: [
        'SYDE OPS1',
        'SYDE OPS2',
        'SYDE OPS3',
        'SYDE OPS4',
        'SYDE OPS5',
        'SYDE OPS6',
        'SYDE OPS7',
        'SYDE OPS8',
        'SYDE OPS9',
        'SYDE OPS10',
      ],
      lossTimeoutDays: 30,
    },
    {
      cityId: 'SYD',
      hubId: 'syd_csp_7',
      name: 'SYD CSP 7',
    },
    {
      cityId: 'BNE',
      hubId: 'brisbane_placeholder',
      name: 'Brisbane Center',
      extraAliases: ['Brisbane Centre', 'Brisbane DS', 'BNE Center', 'BNE DS', 'Brisbane'],
    },
  ],
}

export function cloneDefaultWarehouseConfig(): WarehouseConfigDto {
  return JSON.parse(JSON.stringify(DEFAULT_WAREHOUSE_CONFIG)) as WarehouseConfigDto
}
