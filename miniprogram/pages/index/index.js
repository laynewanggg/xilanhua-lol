const ROLE_ORDER = ["上路", "中路", "下路", "辅助", "打野"];

const HERO_POOL = {
  上路: [
    "盖伦", "诺手", "剑姬", "青钢影", "鳄鱼", "武器大师", "奎桑提", "纳尔", "凯南", "船长",
    "狗头", "奥恩", "瑟提", "克烈", "猴子", "贾克斯", "兰博", "杰斯", "塞恩", "蒙多"
  ],
  中路: [
    "阿狸", "发条", "辛德拉", "佐伊", "维克托", "沙皇", "塞拉斯", "岩雀", "卡萨丁", "加里奥",
    "安妮", "小鱼人", "乐芙兰", "亚索", "永恩", "劫", "卡特琳娜", "瑞兹", "冰女", "维迦"
  ],
  下路: [
    "伊泽瑞尔", "卡莎", "厄斐琉斯", "金克丝", "女警", "霞", "韦鲁斯", "卢锡安", "泽丽", "烬",
    "艾希", "薇恩", "崔丝塔娜", "希维尔", "德莱文", "赛娜", "卡莉丝塔", "大嘴", "莎弥拉", "尼菈"
  ],
  辅助: [
    "锤石", "泰坦", "蕾欧娜", "娜美", "璐璐", "洛", "布隆", "烈娜塔", "巴德", "牛头",
    "机器人", "风女", "琴女", "索拉卡", "婕拉", "莫甘娜", "派克", "米利欧", "卡尔玛", "塔姆"
  ],
  打野: [
    "盲僧", "佛耶戈", "赵信", "皇子", "千珏", "男枪", "皎月", "猪妹", "蔚", "豹女",
    "艾克", "莉莉娅", "努努", "寡妇", "螳螂", "雷克塞", "狗熊", "乌迪尔", "瑟庄妮", "猴子"
  ]
};

const EASTER_EGG_QUOTES = {
  上路: ["这波我能单杀", "打野别来，我能C", "等我三件套", "塔下挂机中", "别吃别吃"],
  中路: ["这把看我游走", "打野来抓一波", "这波线必须推", "对面中单没闪", "等我六级"],
  下路: ["辅助跟我上", "这波能打", "别怂就是干", "等我无尽", "对面AD没双招"],
  辅助: ["AD别送", "我来开团", "视野做好了", "跟我游走", "保护我方C位"],
  打野: ["这波我反蹲", "龙刷新了", "对面打野在下", "来抓人了", "等我四级"]
};

const LOL_TOTAL_HEROES = 170;

Page({
  data: {
    globalBp: false,
    blueTeam: [],
    redTeam: [],
    usedPool: [],
    usageHistory: [],
    usedCountText: "已使用 0 个英雄",
    status: "",
    statusType: "normal",
    winRate: { blue: 50, red: 50 },
    showEasterEgg: false,
    easterEggQuote: "",
    totalHeroes: LOL_TOTAL_HEROES,
    roundUsedHeroes: 0,
    usedHeroesCount: 0,
    remainingHeroes: LOL_TOTAL_HEROES
  },

  onLoad() {
    this.usedGlobal = new Set();
    this.usedDisplay = new Set();
    this.renderUsedPool();
  },

  onGlobalBpChange(event) {
    const values = event.detail.value || [];
    const globalBp = values.includes("globalBp");
    this.setData({ globalBp });
    this.updateBpStats();
  },

  pickOne(candidates) {
    const index = Math.floor(Math.random() * candidates.length);
    return candidates[index];
  },

  buildTeam(roleToHero) {
    return ROLE_ORDER.map((role) => ({ role, hero: roleToHero[role] }));
  },

  renderUsedPool() {
    const used = Array.from(this.usedDisplay).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
    this.setData({
      usedPool: used,
      usedCountText: `已使用 ${used.length} 个英雄`
    });
    this.updateBpStats();
  },

  updateBpStats(roundUsedHeroes = this.data.roundUsedHeroes) {
    const usedCount = this.usedGlobal.size;
    this.setData({
      roundUsedHeroes,
      usedHeroesCount: usedCount,
      remainingHeroes: Math.max(0, this.data.totalHeroes - usedCount)
    });
  },

  triggerEasterEgg() {
    const roles = Object.keys(EASTER_EGG_QUOTES);
    const randomRole = roles[Math.floor(Math.random() * roles.length)];
    const quotes = EASTER_EGG_QUOTES[randomRole];
    const randomQuote = quotes[Math.floor(Math.random() * quotes.length)];

    this.setData({
      showEasterEgg: true,
      easterEggQuote: `[${randomRole}] ${randomQuote}`
    });

    setTimeout(() => {
      this.setData({ showEasterEgg: false });
    }, 3000);
  },

  generateLineup() {
    const enableGlobalBp = this.data.globalBp;
    const takenThisRound = new Set();
    const blue = {};
    const red = {};

    for (const role of ROLE_ORDER) {
      const blueCandidates = HERO_POOL[role].filter(
        (hero) => !takenThisRound.has(hero) && (!enableGlobalBp || !this.usedGlobal.has(hero))
      );

      if (blueCandidates.length === 0) {
        this.setData({
          status: `错误：${role}可用英雄不足，请重置。`,
          statusType: "error"
        });
        return;
      }

      const bluePick = this.pickOne(blueCandidates);
      blue[role] = bluePick;
      takenThisRound.add(bluePick);

      const redCandidates = HERO_POOL[role].filter(
        (hero) => !takenThisRound.has(hero) && (!enableGlobalBp || !this.usedGlobal.has(hero))
      );

      if (redCandidates.length === 0) {
        this.setData({
          status: `错误：${role}可用英雄不足，请重置。`,
          statusType: "error"
        });
        return;
      }

      const redPick = this.pickOne(redCandidates);
      red[role] = redPick;
      takenThisRound.add(redPick);
    }

    const roundHeroes = [...Object.values(blue), ...Object.values(red)];
    roundHeroes.forEach((hero) => this.usedDisplay.add(hero));

    if (enableGlobalBp) {
      roundHeroes.forEach((hero) => this.usedGlobal.add(hero));
    }

    const blueTeam = this.buildTeam(blue);
    const redTeam = this.buildTeam(red);

    const bRate = 45 + Math.floor(Math.random() * 11);
    const rRate = 100 - bRate;

    let usageHistory = this.data.usageHistory;
    const roundIndex = usageHistory.length + 1;
    const positions = ROLE_ORDER.map((role) => ({
      role,
      blue: blue[role],
      red: red[role]
    }));
    usageHistory = [{ round: roundIndex, positions }, ...usageHistory];

    this.setData({
      blueTeam,
      redTeam,
      usageHistory,
      status: "征召完成：阵容已就绪",
      statusType: "success",
      winRate: { blue: bRate, red: rRate }
    });

    this.renderUsedPool();
    this.updateBpStats(takenThisRound.size);

    if (Math.random() < 0.2) {
      this.triggerEasterEgg();
    }
  },

  resetGame() {
    this.usedGlobal.clear();
    this.usedDisplay.clear();
    this.setData({
      blueTeam: [],
      redTeam: [],
      usageHistory: [],
      status: "系统重置：状态已清空",
      statusType: "normal",
      winRate: { blue: 50, red: 50 }
    });
    this.renderUsedPool();
    this.updateBpStats(0);
  },

  onLongPressHeader() {
    wx.showToast({ title: "海克斯科技系统 v2.0 - 为十人内战而生", icon: "none", duration: 2000 });
  }
});
