/* ============================================================================
 * 种子数据：25 家店（22 家真实 + 3 家校内示例），只保留店铺，不含任何评价
 * 坐标均为 GCJ-02。source 全部为 'seed'。
 * ========================================================================== */
(function (root) {
  'use strict';

  var RESTAURANTS = [
    /* ---- 清水河校区周边（郫都区） ---- */
    { id: 'r01', name: '银桦餐厅', category: '食堂', priceLevel: 1, lat: 30.754401, lng: 103.931184, address: '电子科技大学清水河校区内', tags: ['食堂', '人均 10 元', '量大', '赶课首选'] },
    { id: 'r02', name: '朝阳餐厅', category: '食堂', priceLevel: 1, lat: 30.755917, lng: 103.934077, address: '西源大道 2006 号', tags: ['食堂', '冒菜窗口', '牛肉面'] },
    { id: 'r03', name: '紫荆餐厅', category: '食堂', priceLevel: 1, lat: 30.754681, lng: 103.930694, address: '天润路 硕丰二组团', tags: ['食堂', '饺子', '空调足'] },
    { id: 'r04', name: '西北餐厅', category: '食堂', priceLevel: 1, lat: 30.754798, lng: 103.930057, address: '西源大道 2006 号', tags: ['食堂', '面食', '肉夹馍'] },
    { id: 'r05', name: '顽石餐饮(科创餐厅)', category: '快餐', priceLevel: 2, lat: 30.752592, lng: 103.934255, address: '西源大道 2006 号', tags: ['快餐', '套餐', '环境干净'] },
    { id: 'r06', name: '肯德基(电子科大店)', category: '快餐', priceLevel: 3, lat: 30.755696, lng: 103.933667, address: '朝阳餐厅二楼', tags: ['炸鸡', 'Wi-Fi', '深夜营业'] },
    { id: 'r07', name: '麦当劳(学子食堂店)', category: '快餐', priceLevel: 2, lat: 30.752522, lng: 103.934145, address: '电子科技大学商业街', tags: ['汉堡', '24 小时', '随心配'] },
    { id: 'r08', name: '三米粥铺(龙湖时代天街)', category: '粥粉面', priceLevel: 2, lat: 30.753953, lng: 103.923388, address: '合作路 89 号 23 栋附 162', tags: ['粥', '生煎', '养胃'] },
    { id: 'r09', name: '沙县小吃(时代天街)', category: '小吃', priceLevel: 1, lat: 30.753698, lng: 103.924280, address: '清水河校区西门西南 280 米', tags: ['拌面', '蒸饺', '快捷'] },
    { id: 'r10', name: '兰州牛肉面(科大店)', category: '面馆', priceLevel: 2, lat: 30.754070, lng: 103.924697, address: '天润路 495 号', tags: ['牛肉面', '现拉', '辣椒油'] },

    /* ---- 建设路（成华区） ---- */
    { id: 'r11', name: '钟水饺(建设路店)', category: '小吃', priceLevel: 2, lat: 30.668035, lng: 104.100483, address: '建设路 53 号', tags: ['红油水饺', '老字号', '必吃'] },
    { id: 'r12', name: '宫廷糕点铺(建设路店)', category: '甜品', priceLevel: 1, lat: 30.668374, lng: 104.101354, address: '建设路 47 号附 1-5', tags: ['蛋挞', '桃酥', '现烤'] },
    { id: 'r13', name: '鄢知味冒菜', category: '冒菜', priceLevel: 2, lat: 30.668614, lng: 104.102237, address: '建设路 43 号二区', tags: ['冒菜', '可调辣度', '牛肉嫩'] },
    { id: 'r14', name: '甜水面·成都名小吃集合店', category: '小吃', priceLevel: 2, lat: 30.670720, lng: 104.101220, address: '建设中路 15 号', tags: ['甜水面', '抄手', '分量小'] },
    { id: 'r15', name: '回水镇·江湖川菜', category: '川菜', priceLevel: 3, lat: 30.667990, lng: 104.100345, address: '建设路 53 号附 13', tags: ['川菜', '聚餐', '跳水鱼'] },
    { id: 'r16', name: '刘文祥麻辣烫', category: '麻辣烫', priceLevel: 2, lat: 30.669251, lng: 104.101763, address: '建设路 26 号附 2', tags: ['麻辣烫', '干拌', '自选'] },

    /* ---- 春熙路（锦江区） ---- */
    { id: 'r17', name: '蜀大侠火锅(总府路总店)', category: '火锅', priceLevel: 3, lat: 30.658284, lng: 104.078766, address: '商业场街 1 号 2 楼', tags: ['火锅', '毛肚', '排队'] },
    { id: 'r18', name: '小龙坎火锅(全球总店)', category: '火锅', priceLevel: 4, lat: 30.651859, lng: 104.078477, address: '下东大街段 188 号时代华章 2 楼', tags: ['火锅', '牛油锅', '偏贵'] },
    { id: 'r19', name: '喜福老火锅(春熙太古里店)', category: '火锅', priceLevel: 4, lat: 30.657117, lng: 104.081240, address: '总府路 1 号 4 楼', tags: ['火锅', '服务好', '酥肉'] },
    { id: 'r20', name: '三圣巷老火锅(太古里店)', category: '火锅', priceLevel: 3, lat: 30.656417, lng: 104.079584, address: '正科甲巷 76 号', tags: ['火锅', '巷子老店', '现炒锅底'] },

    /* ---- 玉林（武侯区） ---- */
    { id: 'r21', name: '陶源小味川菜', category: '川菜', priceLevel: 3, lat: 30.633619, lng: 104.063645, address: '一环路南三段 11-12 号', tags: ['川菜', '豆瓣鱼', '家常味'] },
    { id: 'r22', name: '岗火自贡·尖货爆炒(玉林店)', category: '川菜', priceLevel: 3, lat: 30.629531, lng: 104.063979, address: '玉林东路 1 号附 6', tags: ['自贡菜', '鲜锅兔', '重口'] },

    /* ---- 校内「踩雷」示例（虚构店名，用于填充小杯档） ---- */
    { id: 'r23', name: '学一美食城(三楼)', category: '快餐', priceLevel: 2, lat: 30.753820, lng: 103.932760, address: '电子科技大学清水河校区 学一食堂三楼', tags: ['加热柜', '凉菜', '踩雷'] },
    { id: 'r24', name: '火焰山烤肉饭(商业街店)', category: '快餐', priceLevel: 2, lat: 30.752180, lng: 103.933620, address: '电子科技大学商业街 12 号', tags: ['烤肉饭', '已停业', '踩雷'], closed: true },
    { id: 'r25', name: '鲜果时光轻食', category: '轻食', priceLevel: 3, lat: 30.755420, lng: 103.935010, address: '西源大道 2006 号 学生活动中心 1 楼', tags: ['沙拉', '轻食', '贵'] }
  ];

  /* 评价压缩格式：r=店铺 id, a=昵称, s=[味道,性价比,服务,环境], v=1 推荐 / 0 不推荐, t=正文, d=日期 */

  /**
   * 把压缩格式展开成完整数据模型。
   * @returns {{restaurants:Array, reviews:Array}}
   */
  function buildSeed() {
    var restaurants = RESTAURANTS.map(function (r) {
      return {
        id: r.id,
        name: r.name,
        category: r.category,
        priceLevel: r.priceLevel,
        address: r.address,
        lat: r.lat,
        lng: r.lng,
        tags: r.tags.slice(),
        closed: !!r.closed,
        source: 'seed',
        needsLocation: false,
        createdAt: '2026-04-01T09:00:00.000Z',
        createdBy: 'Ginkgo 烹饪社'
      };
    });

    // 示例评价已移除：分数只来自真实社员打分，新库从「待评级」开始
    return { restaurants: restaurants, reviews: [] };
  }

  var api = { buildSeed: buildSeed };
  root.SeedData = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
