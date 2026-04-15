/* ============================
   西兰花战绩系统 v2 · 小程序存储层
   ============================ */

const KEYS = {
  matches: 'xlh_v2_matches',
  players: 'xlh_v2_players',
  corrections: 'xlh_v2_corrections'  // AI 识别纠错记忆
};

// 英雄池
const heroPool = {
  上路: ["盖伦","诺手","剑姬","鳄鱼","奎桑提","纳尔","凯南","船长","狗头","奥恩","瑟提","克烈","猴子","贾克斯","兰博","杰斯","塞恩","蒙多","铁男","波比","约里克","提莫","潘森","刀妹","锐雯","奎因","弗拉基米尔","阿卡丽","酒桶","卡蜜尔","安蓓萨","梅尔","格温","俄洛伊","厄加特","天使","蛮王","炼金","石头人","剑魔"],
  中路: ["阿狸","发条","辛德拉","佐伊","维克托","沙皇","塞拉斯","岩雀","卡萨丁","加里奥","安妮","小鱼人","妖姬","亚索","永恩","劫","卡特琳娜","瑞兹","维迦","蛇女","泽拉斯","拉克丝","阿萝拉","马尔扎哈","火男","丽桑卓","兹拉特","斯莫德","奇亚娜","阿卡丽","凯隐","斯维因","卡牌","凤凰","大头","男刀","炸弹人","龙王","阿克尚","妮蔻","薇古丝","彗","纳菲丽"],
  下路: ["伊泽瑞尔","卡莎","厄斐琉斯","金克丝","女警","霞","韦鲁斯","卢锡安","泽丽","烬","艾希","薇恩","崔丝塔娜","希维尔","德莱文","赛娜","卡莉丝塔","大嘴","莎弥拉","尼菈","好运姐","库奇","斯莫德","老鼠"],
  辅助: ["锤石","泰坦","蕾欧娜","娜美","璐璐","洛","布隆","烈娜塔","巴德","牛头","机器人","风女","琴女","索拉卡","婕拉","莫甘娜","派克","米利欧","卡尔玛","塔姆","悠米","芮尔","慎","塞拉芬","拉克丝","基兰","塔里克","阿木木","维克兹"],
  打野: ["盲僧","佛耶戈","赵信","皇子","千珏","男枪","皎月","猪妹","蔚","豹女","艾克","莉莉娅","努努","寡妇","螳螂","雷克塞","狗熊","乌迪尔","猴子","蜘蛛","稻草人","奥拉夫","凯隐","梦魇","蝎子","龙龟","雷恩加尔","希瓦娜","扎克","艾翁","大虫子","狼人","剑圣","大树","小丑","巨魔","人马","虚空女皇","贝蕾亚","死歌"]
};

const ALL_HEROES = [...new Set(Object.values(heroPool).flat())].sort((a, b) => a.localeCompare(b, 'zh-Hans-CN'));
const ROLE_ORDER = ['上路', '中路', '下路', '辅助', '打野'];
const ROLE_ICONS = { 上路: '🗡️', 中路: '🔮', 下路: '🏹', 辅助: '🛡️', 打野: '🐾' };

const DB = {
  // --- 比赛数据 ---
  loadMatches() {
    try { return JSON.parse(wx.getStorageSync(KEYS.matches)) || []; }
    catch (e) { return []; }
  },
  saveMatches(data) { wx.setStorageSync(KEYS.matches, JSON.stringify(data)); },
  addMatch(match) {
    const all = this.loadMatches();
    all.unshift(match);
    this.saveMatches(all);
  },
  deleteMatch(id) {
    const all = this.loadMatches().filter(m => m.id !== id);
    this.saveMatches(all);
  },
  clearMatches() { wx.removeStorageSync(KEYS.matches); },

  // --- 选手档案 ---
  loadPlayers() {
    try { return JSON.parse(wx.getStorageSync(KEYS.players)) || {}; }
    catch (e) { return {}; }
  },
  savePlayers(data) { wx.setStorageSync(KEYS.players, JSON.stringify(data)); },
  addPlayer(player) {
    const all = this.loadPlayers();
    all[player.id] = player;
    this.savePlayers(all);
  },
  deletePlayer(id) {
    const all = this.loadPlayers();
    delete all[id];
    this.savePlayers(all);
  },
  getPlayer(id) {
    return this.loadPlayers()[id] || null;
  },

  /** 获取选手显示名：有 nick 优先用 nick，否则用 id */
  getDisplayName(id) {
    const p = this.loadPlayers()[id];
    return (p && p.nick) ? p.nick : id;
  },

  /**
   * 清理存量选手数据：
   * 1. 删除无战绩的空档案
   * 2. 智能合并截断名（如 "吃什么呢给..." 和 "吃什么呢给我尝尝#33547" 是同一人）
   * 3. 合并后同步更新比赛记录中的选手名
   */
  deduplicatePlayers() {
    const players = this.loadPlayers();
    const matches = this.loadMatches();

    // 收集所有实际出现过的选手名
    const activeNames = new Set();
    matches.forEach(m => {
      [...m.blue, ...m.red].forEach(p => activeNames.add(p.name));
    });

    // 第一步：删除无战绩空档案
    const ids = Object.keys(players);
    for (const id of ids) {
      if (!activeNames.has(id)) {
        delete players[id];
      }
    }

    // 第二步：智能合并截断名
    // 将名字标准化：去掉末尾的 ... 和 #数字... 截断标记
    function cleanName(name) {
      return name.replace(/\.{2,}$/, '').replace(/#\d*\.{0,}$/, '').trim();
    }

    // 判断 a 和 b 是否是同一人的截断名
    function isSamePerson(a, b) {
      if (a === b) return true;
      const ca = cleanName(a);
      const cb = cleanName(b);
      if (ca === cb) return true;
      // 短的是长的前缀（至少3个字符才判断，避免误合并）
      const minLen = Math.min(ca.length, cb.length);
      if (minLen < 3) return false;
      // 一个包含另一个的开头
      if (ca.startsWith(cb) || cb.startsWith(ca)) return true;
      return false;
    }

    // 对所有活跃名字建立合并组
    const allNames = [...activeNames];
    const mergeMap = {};  // oldName → canonicalName (最长的那个)

    for (let i = 0; i < allNames.length; i++) {
      if (mergeMap[allNames[i]]) continue;
      const group = [allNames[i]];
      for (let j = i + 1; j < allNames.length; j++) {
        if (mergeMap[allNames[j]]) continue;
        if (isSamePerson(allNames[i], allNames[j])) {
          group.push(allNames[j]);
        }
      }
      if (group.length > 1) {
        // 选最长的名字作为标准名
        group.sort((a, b) => b.length - a.length);
        const canonical = group[0];
        for (const name of group) {
          if (name !== canonical) {
            mergeMap[name] = canonical;
          }
        }
      }
    }

    const mergeCount = Object.keys(mergeMap).length;
    if (mergeCount === 0) {
      this.savePlayers(players);
      return 0;
    }

    console.log('[去重] 合并映射:', JSON.stringify(mergeMap));

    // 第三步：更新比赛记录中的选手名
    let matchUpdated = false;
    matches.forEach(m => {
      [...m.blue, ...m.red].forEach(p => {
        if (mergeMap[p.name]) {
          console.log(`[去重] 比赛 ${m.id}: "${p.name}" → "${mergeMap[p.name]}"`);
          p.name = mergeMap[p.name];
          matchUpdated = true;
        }
      });
    });
    if (matchUpdated) {
      this.saveMatches(matches);
    }

    // 第四步：合并选手档案
    for (const [oldName, newName] of Object.entries(mergeMap)) {
      const oldProfile = players[oldName];
      if (!oldProfile) continue;
      const existing = players[newName] || { id: newName, nick: '', roles: [], signatureHeroes: [], note: '', createdAt: Date.now() };
      // 合并信息
      if (!existing.nick && oldProfile.nick) existing.nick = oldProfile.nick;
      if (oldProfile.note && !existing.note) existing.note = oldProfile.note;
      const heroSet = new Set([...(existing.signatureHeroes || []), ...(oldProfile.signatureHeroes || [])]);
      existing.signatureHeroes = [...heroSet];
      const roleSet = new Set([...(existing.roles || []), ...(oldProfile.roles || [])]);
      existing.roles = [...roleSet];
      players[newName] = existing;
      delete players[oldName];
    }

    this.savePlayers(players);
    console.log(`[去重] 完成，合并了 ${mergeCount} 条截断名`);
    return mergeCount;
  },

  // --- 选手统计 ---
  getPlayerStats(playerName) {
    const all = this.loadMatches();
    const stats = {
      wins: 0, losses: 0, kills: 0, deaths: 0, assists: 0,
      games: 0, heroes: {}, roles: {}, streaks: [],
      recentMatches: []
    };
    all.forEach(match => {
      [...match.blue, ...match.red].forEach(p => {
        if (p.name === playerName) {
          const side = match.blue.some(bp => bp.name === p.name && bp.hero === p.hero) ? 'blue' : 'red';
          const isWin = match.winner === side;
          stats.games++;
          if (isWin) stats.wins++; else stats.losses++;
          stats.kills += p.kills;
          stats.deaths += p.deaths;
          stats.assists += p.assists;
          stats.heroes[p.hero] = (stats.heroes[p.hero] || 0) + 1;
          stats.roles[p.role] = (stats.roles[p.role] || 0) + 1;
          stats.streaks.push(isWin ? 'W' : 'L');
          stats.recentMatches.push({
            date: match.date, hero: p.hero, role: p.role,
            kills: p.kills, deaths: p.deaths, assists: p.assists,
            win: isWin, matchId: match.id
          });
        }
      });
    });
    stats.currentStreak = calcStreak(stats.streaks);
    stats.avgKDA = stats.deaths > 0 ? ((stats.kills + stats.assists) / stats.deaths).toFixed(2) : 'Perfect';
    stats.winrate = stats.games > 0 ? Math.round((stats.wins / stats.games) * 100) : 0;
    stats.topHeroes = Object.entries(stats.heroes).sort((a, b) => b[1] - a[1]).slice(0, 5);
    stats.topRoles = Object.entries(stats.roles).sort((a, b) => b[1] - a[1]);
    return stats;
  },

  getAllPlayerNames() {
    const all = this.loadMatches();
    const names = new Set();
    all.forEach(m => {
      [...m.blue, ...m.red].forEach(p => names.add(p.name));
    });
    return [...names];
  },

  getMatchesByPlayer(name, limit) {
    return this.loadMatches().filter(m =>
      [...m.blue, ...m.red].some(p => p.name === name)
    ).slice(0, limit || Infinity);
  },

  getMatchesByDateRange(from, to) {
    return this.loadMatches().filter(m => m.date >= from && m.date <= to);
  },

  getPlayerHeroHistory(playerName, heroName) {
    const all = this.loadMatches();
    const records = [];
    all.forEach(match => {
      [...match.blue, ...match.red].forEach(p => {
        if (p.name === playerName && p.hero === heroName) {
          const side = match.blue.some(bp => bp.name === p.name && bp.hero === p.hero) ? 'blue' : 'red';
          records.push({ ...p, date: match.date, win: match.winner === side });
        }
      });
    });
    return records;
  },

  exportAll() {
    return JSON.stringify({
      matches: this.loadMatches(),
      players: this.loadPlayers(),
      corrections: this.loadCorrections(),
      exportDate: new Date().toISOString(),
      version: 'v2'
    }, null, 2);
  },

  importAll(jsonStr) {
    try {
      const data = JSON.parse(jsonStr);
      if (data.matches) this.saveMatches(data.matches);
      if (data.players) this.savePlayers(data.players);
      if (data.corrections) this.saveCorrections(data.corrections);
      return true;
    } catch (e) { return false; }
  },

  // --- AI 识别纠错记忆 ---
  loadCorrections() {
    try { return JSON.parse(wx.getStorageSync(KEYS.corrections)) || []; }
    catch (e) { return []; }
  },
  saveCorrections(data) { wx.setStorageSync(KEYS.corrections, JSON.stringify(data)); },

  /**
   * 记录一条纠错：AI 把 wrongHero 识别成了 correctHero
   * 系统会聚合统计，下次识别时注入 prompt 提醒 AI
   */
  addCorrection(wrongHero, correctHero) {
    if (!wrongHero || !correctHero || wrongHero === correctHero) return;
    const all = this.loadCorrections();
    // 查找是否已有相同纠错记录
    const existing = all.find(c => c.wrong === wrongHero && c.correct === correctHero);
    if (existing) {
      existing.count++;
      existing.lastTime = Date.now();
    } else {
      all.push({ wrong: wrongHero, correct: correctHero, count: 1, lastTime: Date.now() });
    }
    // 只保留最近 100 条纠错记录
    all.sort((a, b) => b.lastTime - a.lastTime);
    this.saveCorrections(all.slice(0, 100));
  },

  /**
   * 获取纠错摘要（用于注入 AI prompt）
   * 返回格式：[{ wrong: '影流之主', correct: '机械先驱', count: 3 }, ...]
   */
  getCorrectionSummary() {
    return this.loadCorrections()
      .filter(c => c.count >= 1)
      .sort((a, b) => b.count - a.count)
      .slice(0, 20);
  }
};

function calcStreak(streaks) {
  if (streaks.length === 0) return { type: null, count: 0 };
  const last = streaks[0];
  let count = 0;
  for (const s of streaks) { if (s === last) count++; else break; }
  return { type: last, count };
}

module.exports = {
  DB,
  heroPool,
  ALL_HEROES,
  ROLE_ORDER,
  ROLE_ICONS,
  calcStreak
};
