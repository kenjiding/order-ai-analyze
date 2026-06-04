/** 日常检查表模板行（与纸质表 35 个序号一致） */
export type DailyChecklistTemplateRow = {
  serialNo: number
  category: string
  item: string
  keyPoint: string
}

export const DAILY_CHECKLIST_TITLE = '仓库安全日常检查表'

export const DAILY_CHECKLIST_TEMPLATE: DailyChecklistTemplateRow[] = [
  {
    serialNo: 1,
    category: '人员操作规范',
    item: '员工进出是否穿戴反光背心',
    keyPoint: '进入作业区必须穿戴反光背心',
  },
  {
    serialNo: 2,
    category: '人员操作规范',
    item: '员工进出是否穿戴反光背心',
    keyPoint: '叉车司机系安全带',
  },
  {
    serialNo: 3,
    category: '人员操作规范',
    item: '是否存在违章作业行为',
    keyPoint: '如叉车载人',
  },
  {
    serialNo: 4,
    category: '人员操作规范',
    item: '是否存在违章作业行为',
    keyPoint: '货叉下站人',
  },
  {
    serialNo: 5,
    category: '人员操作规范',
    item: '是否存在违章作业行为',
    keyPoint: '倒车不观察',
  },
  {
    serialNo: 6,
    category: '人员操作规范',
    item: '是否存在违章作业行为',
    keyPoint: '超速行驶',
  },
  {
    serialNo: 7,
    category: '人员操作规范',
    item: '是否存在违章作业行为',
    keyPoint: '货物超高/超宽码放',
  },
  {
    serialNo: 8,
    category: '人员操作规范',
    item: '新员工是否完成岗前培训教育',
    keyPoint: '抽查培训记录及签字，新员工上岗前必须有培训记录',
  },
  {
    serialNo: 9,
    category: '叉车/设备安全',
    item: '叉车日检是否真实执行',
    keyPoint: '检查点检表签字完整性，是否存在提前补签或漏签',
  },
  {
    serialNo: 10,
    category: '叉车/设备安全',
    item: '叉车日检是否真实执行',
    keyPoint: '车辆有无带病作业',
  },
  {
    serialNo: 11,
    category: '叉车/设备安全',
    item: '叉车操作资质/培训',
    keyPoint: '操作人员是否持有操作资质/内部培训合格证明',
  },
  {
    serialNo: 12,
    category: '叉车/设备安全',
    item: '叉车操作资质/培训',
    keyPoint: '是否经过上岗前安全培训',
  },
  {
    serialNo: 13,
    category: '叉车/设备安全',
    item: '叉车充电区',
    keyPoint: '充电区通风、禁止烟火',
  },
  {
    serialNo: 14,
    category: '叉车/设备安全',
    item: '叉车充电区',
    keyPoint: '有无配置灭火器',
  },
  {
    serialNo: 15,
    category: '叉车/设备安全',
    item: '压缩机/分拣机等设备',
    keyPoint: '急停按钮是否有效',
  },
  {
    serialNo: 16,
    category: '叉车/设备安全',
    item: '压缩机/分拣机等设备',
    keyPoint: '防护罩是否齐全',
  },
  {
    serialNo: 17,
    category: '叉车/设备安全',
    item: '压缩机/分拣机等设备',
    keyPoint: '运行中有无异常异响',
  },
  {
    serialNo: 18,
    category: '消防安全',
    item: '消防器材有效性',
    keyPoint: '灭火器压力值正常、未过期',
  },
  {
    serialNo: 19,
    category: '消防安全',
    item: '消防器材有效性',
    keyPoint: '消火栓压力是否正常、水带齐全',
  },
  {
    serialNo: 20,
    category: '消防安全',
    item: '消防器材有效性',
    keyPoint: '每月检查卡是否缺失及填写',
  },
  {
    serialNo: 21,
    category: '消防安全',
    item: '疏散通道与安全出口',
    keyPoint: '通道无堵塞、锁闭',
  },
  {
    serialNo: 22,
    category: '消防安全',
    item: '疏散通道与安全出口',
    keyPoint: '应急照明灯和疏散指示灯工作正常',
  },
  {
    serialNo: 23,
    category: '消防安全',
    item: '易燃物管理',
    keyPoint: '现场纸箱、塑料包装等是否及时清理',
  },
  {
    serialNo: 24,
    category: '消防安全',
    item: '易燃物管理',
    keyPoint: '是否违规存放易燃液体',
  },
  {
    serialNo: 25,
    category: '用电安全',
    item: '配电箱/开关箱',
    keyPoint: '箱门关闭、无杂物遮挡',
  },
  {
    serialNo: 26,
    category: '用电安全',
    item: '配电箱/开关箱',
    keyPoint: '无飞线、私拉乱接',
  },
  {
    serialNo: 27,
    category: '场地与货物安全',
    item: '货物堆垛稳定性',
    keyPoint: '堆高不超过限高（通常不超2米）',
  },
  {
    serialNo: 28,
    category: '场地与货物安全',
    item: '货物堆垛稳定性',
    keyPoint: '有无倒置和倾斜',
  },
  {
    serialNo: 29,
    category: '场地与货物安全',
    item: '货物堆垛稳定性',
    keyPoint: '通道两侧堆垛无倾倒风险',
  },
  {
    serialNo: 30,
    category: '场地与货物安全',
    item: '地面与作业面',
    keyPoint: '无油污、积水',
  },
  {
    serialNo: 31,
    category: '场地与货物安全',
    item: '地面与作业面',
    keyPoint: '破损地坪已修补或设置警示',
  },
  {
    serialNo: 32,
    category: '场地与货物安全',
    item: '主通道是否持续保持畅通',
    keyPoint: '主作业通道无货物、设备、杂物占用',
  },
  {
    serialNo: 33,
    category: '应急与卫生物资',
    item: '急救箱配备及物品齐全',
    keyPoint: '是否配备急救箱',
  },
  {
    serialNo: 34,
    category: '应急与卫生物资',
    item: '急救箱配备及物品齐全',
    keyPoint: '箱内物品（创可贴、消毒液、纱布等）齐全且在有效期内',
  },
  {
    serialNo: 35,
    category: '安全标识与应急',
    item: '安全警示标识',
    keyPoint: '限速、禁止叉车载人、当心车辆等标识清晰、位置明显',
  },
]
