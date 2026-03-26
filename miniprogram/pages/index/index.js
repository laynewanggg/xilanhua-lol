/* ============================
   LOL 内战随机器 v2.0 小程序版
   ============================ */

const ROLE_ORDER = ["上路", "中路", "下路", "辅助", "打野"];

const ROLE_ICONS = {
  上路: "🗡️",
  中路: "🔮",
  下路: "🏹",
  辅助: "🛡️",
  打野: "🐾",
};

const HERO_POOL = {
  上路: [
    "盖伦", "诺手", "剑姬", "鳄鱼", "奎桑提", "纳尔", "凯南", "船长",
    "狗头", "奥恩", "瑟提", "克烈", "猴子", "贾克斯", "兰博", "杰斯", "塞恩", "蒙多",
    "铁男", "波比", "约里克", "提莫", "潘森", "刀妹", "锐雯", "奎因", "弗拉基米尔", "阿卡丽",
    "酒桶", "卡蜜尔", "安蓓萨", "梅尔", "格温", "俄洛伊",
    "厄加特", "天使", "蛮王", "炼金", "石头人", "剑魔"
  ],
  中路: [
    "阿狸", "发条", "辛德拉", "佐伊", "维克托", "沙皇", "塞拉斯", "岩雀", "卡萨丁", "加里奥",
    "安妮", "小鱼人", "妖姬", "亚索", "永恩", "劫", "卡特琳娜", "瑞兹", "维迦",
    "蛇女", "泽拉斯", "拉克丝", "阿萝拉", "马尔扎哈",
    "火男", "丽桑卓", "兹拉特", "斯莫德", "奇亚娜", "阿卡丽", "凯隐",
    "斯维因", "卡牌",
    "凤凰", "大头", "男刀", "炸弹人", "龙王", "阿克尚", "妮蔻", "薇古丝", "彗", "纳菲丽"
  ],
  下路: [
    "伊泽瑞尔", "卡莎", "厄斐琉斯", "金克丝", "女警", "霞", "韦鲁斯", "卢锡安", "泽丽", "烬",
    "艾希", "薇恩", "崔丝塔娜", "希维尔", "德莱文", "赛娜", "卡莉丝塔", "大嘴", "莎弥拉", "尼菈",
    "好运姐", "库奇", "斯莫德", "老鼠"
  ],
  辅助: [
    "锤石", "泰坦", "蕾欧娜", "娜美", "璐璐", "洛", "布隆", "烈娜塔", "巴德", "牛头",
    "机器人", "风女", "琴女", "索拉卡", "婕拉", "莫甘娜", "派克", "米利欧", "卡尔玛", "塔姆",
    "悠米", "芮尔", "慎", "塞拉芬", "拉克丝", "基兰", "塔里克", "阿木木",
    "维克兹"
  ],
  打野: [
    "盲僧", "佛耶戈", "赵信", "皇子", "千珏", "男枪", "皎月", "猪妹", "蔚", "豹女",
    "艾克", "莉莉娅", "努努", "寡妇", "螳螂", "雷克塞", "狗熊", "乌迪尔", "猴子", "蜘蛛",
    "稻草人", "奥拉夫", "凯隐", "梦魇", "蝎子", "龙龟", "雷恩加尔", "希瓦娜",
    "扎克", "艾翁", "大虫子", "狼人", "剑圣", "大树",
    "小丑", "巨魔", "人马", "虚空女皇", "贝蕾亚", "死歌"
  ]
};

// 所有英雄去重排序
const ALL_HEROES = [...new Set(Object.values(HERO_POOL).flat())].sort(
  (a, b) => a.localeCompare(b, "zh-Hans-CN")
);
const TOTAL_HEROES = ALL_HEROES.length;

const EASTER_EGG_QUOTES = {
  上路: ["这波我能单杀", "打野别来，我能C", "等我三件套", "塔下挂机中", "别吃别吃"],
  中路: ["这把看我游走", "打野来抓一波", "这波线必须推", "对面中单没闪", "等我六级"],
  下路: ["辅助跟我上", "这波能打", "别怂就是干", "等我无尽", "对面AD没双招"],
  辅助: ["AD别送", "我来开团", "视野做好了", "跟我游走", "保护我方C位"],
  打野: ["这波我反蹲", "龙刷新了", "对面打野在下", "来抓人了", "等我四级"]
};

Page({
  data: {
    // 基础数据
    globalBp: false,
    blueTeam: [],
    redTeam: [],
    status: "",
    statusType: "normal",

    // Ban 系统
    banInput: "",
    banSuggestions: [],
    bannedList: [],
    bannedCount: 0,

    // 英雄池统计
    roleStats: [],
    totalHeroes: TOTAL_HEROES,

    // 已上场
    usedPool: [],
    usedCount: 0,
    usedProgress: 0,

    // 历史记录
    historyRounds: [],
    roundCount: 0,
    showHistory: false,

    // 彩蛋
    showEasterEgg: false,
    easterEggQuote: "",

    // 动画
    showTeams: false,
    animItems: []
  },

  onLoad() {
    this.usedGlobal = new Set();
    this.bannedHeroes = new Set();
    this.renderStats();
    this.renderUsedPool();
  },

  // ---- Ban 功能 ----
  onBanInput(e) {
    const keyword = e.detail.value.trim();
    this.setData({ banInput: keyword });

    if (!keyword) {
      this.setData({ banSuggestions: [] });
      return;
    }

    const matches = ALL_HEROES.filter(
      (h) => h.includes(keyword) && !this.bannedHeroes.has(h)
    ).slice(0, 15);

    this.setData({ banSuggestions: matches });
  },

  onBanConfirm(e) {
    const val = e.detail.value.trim();
    if (ALL_HEROES.includes(val) && !this.bannedHeroes.has(val)) {
      this.bannedHeroes.add(val);
      this.setData({ banInput: "", banSuggestions: [] });
      this.renderBanList();
      this.renderStats();
    }
  },

  onSelectBanHero(e) {
    const hero = e.currentTarget.dataset.hero;
    this.bannedHeroes.add(hero);
    this.setData({ banInput: "", banSuggestions: [] });
    this.renderBanList();
    this.renderStats();
  },

  onRemoveBan(e) {
    const hero = e.currentTarget.dataset.hero;
    this.bannedHeroes.delete(hero);
    this.renderBanList();
    this.renderStats();
  },

  clearAllBans() {
    this.bannedHeroes.clear();
    this.renderBanList();
    this.renderStats();
  },

  renderBanList() {
    const list = [...this.bannedHeroes].sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    );
    this.setData({
      bannedList: list,
      bannedCount: list.length
    });
  },

  // ---- 英雄池统计 ----
  renderStats() {
    const stats = ROLE_ORDER.map((role) => {
      const total = HERO_POOL[role].length;
      const available = HERO_POOL[role].filter(
        (h) => !this.usedGlobal.has(h) && !this.bannedHeroes.has(h)
      ).length;
      return {
        role,
        icon: ROLE_ICONS[role],
        total,
        available
      };
    });
    this.setData({ roleStats: stats });
  },

  // ---- 已上场英雄 ----
  renderUsedPool() {
    const used = Array.from(this.usedGlobal).sort((a, b) =>
      a.localeCompare(b, "zh-Hans-CN")
    );
    this.setData({
      usedPool: used,
      usedCount: used.length,
      usedProgress: TOTAL_HEROES > 0 ? (used.length / TOTAL_HEROES) * 100 : 0
    });
  },

  // ---- 全局 BP 切换 ----
  onGlobalBpChange(e) {
    this.setData({ globalBp: e.detail.value });
  },

  // ---- 彩蛋 ----
  triggerEasterEgg() {
    const roles = Object.keys(EASTER_EGG_QUOTES);
    const role = roles[Math.floor(Math.random() * roles.length)];
    const quotes = EASTER_EGG_QUOTES[role];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];

    this.setData({
      showEasterEgg: true,
      easterEggQuote: `[${role}] ${quote}`
    });

    setTimeout(() => {
      this.setData({ showEasterEgg: false });
    }, 3000);
  },

  // ---- 生成阵容 ----
  generateLineup() {
    const enableGlobalBp = this.data.globalBp;
    const takenThisRound = new Set();
    const blue = {};
    const red = {};

    for (const role of ROLE_ORDER) {
      const blueCandidates = HERO_POOL[role].filter(
        (hero) =>
          !takenThisRound.has(hero) &&
          !this.bannedHeroes.has(hero) &&
          (!enableGlobalBp || !this.usedGlobal.has(hero))
      );

      if (blueCandidates.length === 0) {
        this.setData({
          status: `⚠️ ${role}可用英雄不足，请减少Ban位或关闭全局BP`,
          statusType: "error"
        });
        return;
      }

      const bluePick = blueCandidates[Math.floor(Math.random() * blueCandidates.length)];
      blue[role] = bluePick;
      takenThisRound.add(bluePick);

      const redCandidates = HERO_POOL[role].filter(
        (hero) =>
          !takenThisRound.has(hero) &&
          !this.bannedHeroes.has(hero) &&
          (!enableGlobalBp || !this.usedGlobal.has(hero))
      );

      if (redCandidates.length === 0) {
        this.setData({
          status: `⚠️ ${role}可用英雄不足，请减少Ban位或关闭全局BP`,
          statusType: "error"
        });
        return;
      }

      const redPick = redCandidates[Math.floor(Math.random() * redCandidates.length)];
      red[role] = redPick;
      takenThisRound.add(redPick);
    }

    const blueTeam = ROLE_ORDER.map((role) => ({
      role,
      icon: ROLE_ICONS[role],
      hero: blue[role]
    }));
    const redTeam = ROLE_ORDER.map((role) => ({
      role,
      icon: ROLE_ICONS[role],
      hero: red[role]
    }));

    // 更新全局 BP
    if (enableGlobalBp) {
      Object.values(blue).forEach((h) => this.usedGlobal.add(h));
      Object.values(red).forEach((h) => this.usedGlobal.add(h));
    }

    // 保存历史
    const roundCount = this.data.roundCount + 1;
    const time = new Date().toLocaleTimeString("zh-CN");
    const historyRounds = [
      {
        round: roundCount,
        time,
        blue: blueTeam,
        red: redTeam
      },
      ...this.data.historyRounds
    ];

    // 先清空再设置，触发动画
    this.setData({ showTeams: false });

    setTimeout(() => {
      const bannedCount = this.bannedHeroes.size;
      this.setData({
        blueTeam,
        redTeam,
        roundCount,
        historyRounds,
        showTeams: true,
        status:
          `✅ 第${roundCount}轮生成成功！10个不重复英雄` +
          (bannedCount > 0 ? ` · Ban ${bannedCount}位` : "") +
          (enableGlobalBp ? ` · 已用${this.usedGlobal.size}/${TOTAL_HEROES}` : ""),
        statusType: "success"
      });

      this.renderUsedPool();
      this.renderStats();

      // 20% 概率触发彩蛋
      if (Math.random() < 0.2) {
        this.triggerEasterEgg();
      }

      // 震动反馈
      wx.vibrateShort({ type: "medium" });
    }, 100);
  },

  // ---- 重置整局 ----
  resetGame() {
    wx.showModal({
      title: "确认重置",
      content: "将清空所有状态、Ban位和历史记录，确认？",
      success: (res) => {
        if (res.confirm) {
          this.usedGlobal.clear();
          this.bannedHeroes.clear();
          this.setData({
            blueTeam: [],
            redTeam: [],
            roundCount: 0,
            historyRounds: [],
            bannedList: [],
            bannedCount: 0,
            showTeams: false,
            status: "🔄 已重置整局，所有状态已清空",
            statusType: "normal"
          });
          this.renderUsedPool();
          this.renderStats();
          this.renderBanList();
          wx.vibrateShort({ type: "light" });
        }
      }
    });
  },

  // ---- 历史记录弹窗 ----
  openHistory() {
    this.setData({ showHistory: true });
  },

  closeHistory() {
    this.setData({ showHistory: false });
  },

  onHistoryMaskTap() {
    this.setData({ showHistory: false });
  },

  preventBubble() {
    // 阻止事件冒泡
  },

  // ---- 长按彩蛋 ----
  onLongPressHeader() {
    wx.showToast({
      title: "LOL 内战随机器 v2.0\n172位英雄 · Ban位系统",
      icon: "none",
      duration: 2500
    });
  }
});
