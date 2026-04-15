/* ============================
   战绩分析综合页
   整合：录入 / 选手 / 点评 / 历史
   ============================ */
const { DB, ALL_HEROES, ROLE_ORDER, ROLE_ICONS } = require('../../utils/db');
const { generateMatchReview, generatePlayerReview } = require('../../utils/review-engine');

const TEST_NAMES = ['西兰花','大西瓜','小番茄','老土豆','菜花哥','黄瓜弟','芒果王','草莓酱','柠檬精','辣椒人'];

function makeTeam() {
  return ROLE_ORDER.map(role => ({
    role, icon: ROLE_ICONS[role], hero: '', name: '', kills: '', deaths: '', assists: ''
  }));
}

Page({
  data: {
    // ---- 内部 Tab ----
    activeTab: 'record',

    // ---- 录入模块 ----
    screenshot: '',
    matchDate: '',
    matchDuration: '',
    matchTag: '',
    winnerIndex: 0,
    winnerOptions: [{ label: '🔵 蓝色方', value: 'blue' }, { label: '🔴 红色方', value: 'red' }],
    blueTeam: makeTeam(),
    redTeam: makeTeam(),
    heroSuggestions: [],
    heroSugSide: '',
    heroSugIndex: -1,
    ocrStatus: '',    // '' | 'loading' | 'done' | 'fail'
    ocrOriginalResult: null,  // AI 原始识别结果，用于对比纠错
    nameSuggestions: [],
    nameSugSide: '',
    nameSugIndex: -1,

    // ---- 选手模块 ----
    playerCards: [],
    showAddForm: false,
    newId: '', newNick: '', newHeroes: '', newNote: '',
    showDetail: false,
    detailPlayerId: '',
    detailTitle: '',
    detailStats: {},
    detailNote: '',
    detailNick: '',
    detailHeroes: [],
    detailMatches: [],

    // ---- 点评模块 ----
    reviewPrompt: '',
    quickPlayerTags: [],
    hasResult: false,
    reviewType: '',
    reviewLabel: '',
    reviewResults: [],
    playerReview: null,

    // ---- 历史模块（内嵌在录入Tab下方） ----
    expandedMatchId: '',  // 当前展开的比赛ID
    historyFilter: '',
    matchList: [],
    totalGames: 0,
    totalPlayers: 0,
    totalKills: 0,
    weekIdx: 0,
    weekOptions: [{ label: '本周', value: 'this' }, { label: '上周', value: 'last' }],
    awards: [],
    awardsEmpty: false
  },

  _allMatches: [],

  onLoad(options) {
    this.setData({ matchDate: new Date().toISOString().slice(0, 10) });
    // 支持从分享卡片进入时自动跳转
    if (options && options.tab) {
      this.setData({ activeTab: options.tab });
    }
    if (options && options.player) {
      this._pendingPlayer = decodeURIComponent(options.player);
    }
  },

  onShow() {
    // 存量选手数据去重（首次执行后无额外开销）
    const removed = DB.deduplicatePlayers();
    if (removed > 0) {
      console.log(`[onShow] 清理了 ${removed} 条重复选手档案`);
    }
    this._refreshCurrentTab();
    // 从分享进入时自动打开选手详情
    if (this._pendingPlayer) {
      const playerId = this._pendingPlayer;
      this._pendingPlayer = null;
      setTimeout(() => {
        this.showPlayerDetail({ currentTarget: { dataset: { id: playerId } } });
      }, 300);
    }
  },

  // =========== 内部 Tab 切换 ===========
  switchTab(e) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
    this._refreshCurrentTab();
  },

  _refreshCurrentTab() {
    const tab = this.data.activeTab;
    if (tab === 'record') { this._renderHistoryList(); this._renderHistoryStats(); }
    else if (tab === 'players') this._renderPlayerCards();
    else if (tab === 'review') this._refreshReviewSelectors();
  },

  // =========================================================
  //                    录入模块
  // =========================================================

  /**
   * 选择截图 → 压缩 → 多模态大模型识别 → 自动填入
   * 全自动流程，用户只需选择图片
   */
  chooseScreenshot() {
    wx.chooseMedia({
      count: 1,
      mediaType: ['image'],
      sourceType: ['album', 'camera'],
      success: (res) => {
        const tempPath = res.tempFiles[0].tempFilePath;
        // 只保存临时路径（不转 base64 到 data，避免 setData 卡死）
        this.setData({ screenshot: tempPath, ocrStatus: 'loading' });
        wx.showLoading({ title: 'AI 正在识别截图...', mask: true });
        // 自动开始 AI 视觉识别
        this._analyzeScreenshot(tempPath);
      },
      fail: () => {}
    });
  },

  removeScreenshot() {
    this.setData({
      screenshot: '', ocrStatus: '',
      blueTeam: makeTeam(), redTeam: makeTeam(),
      matchDuration: '', matchTag: '', winnerIndex: 0
    });
  },

  /**
   * 核心流程：压缩图片 → 调用后端多模态大模型 → 直接获取结构化数据 → 自动填入
   * 不需要 OCR + 正则解析，大模型直接看图返回 JSON
   */
  _analyzeScreenshot(imagePath) {
    // 第一步：压缩图片为 base64
    this._compressImage(imagePath).then(base64 => {
      console.log('[Vision] 图片压缩完成, base64长度:', base64.length);
      // 第二步：调用后端 Vision API
      return this._callVisionAPI(base64);
    }).then(result => {
      wx.hideLoading();
      if (!result) {
        this.setData({ ocrStatus: 'fail' });
        wx.showToast({ title: '识别失败，请手动填写', icon: 'none', duration: 2000 });
        return;
      }
      // 第三步：直接填入结构化数据（大模型已经返回了标准 JSON）
      this._fillMatchData(result);
    }).catch(err => {
      console.error('[Vision Error]', err);
      wx.hideLoading();
      this.setData({ ocrStatus: 'fail' });
      wx.showToast({ title: '识别失败：' + (err.message || '网络错误'), icon: 'none', duration: 2500 });
    });
  },

  /**
   * 将大模型返回的结构化数据填入表单
   * @param {object} data - { blue: [], red: [], winner: '', duration: '' }
   */
  _fillMatchData(data) {
    const update = { ocrStatus: 'done' };
    const blueTeam = makeTeam();
    const redTeam = makeTeam();

    // 保存 AI 原始识别结果（深拷贝），提交时对比用户修改
    const ocrOriginal = { blue: [], red: [] };

    // 填入蓝方
    if (data.blue && data.blue.length > 0) {
      data.blue.forEach((p, i) => {
        if (i < 5) {
          const hero = this._matchHero(p.hero) || p.hero || '';
          blueTeam[i] = {
            ...blueTeam[i],
            hero,
            name: p.name || '',
            kills: p.kills || '',
            deaths: p.deaths || '',
            assists: p.assists || ''
          };
          ocrOriginal.blue[i] = hero;  // 记录 AI 识别的英雄名
        }
      });
      update.blueTeam = blueTeam;
    }

    // 填入红方
    if (data.red && data.red.length > 0) {
      data.red.forEach((p, i) => {
        if (i < 5) {
          const hero = this._matchHero(p.hero) || p.hero || '';
          redTeam[i] = {
            ...redTeam[i],
            hero,
            name: p.name || '',
            kills: p.kills || '',
            deaths: p.deaths || '',
            assists: p.assists || ''
          };
          ocrOriginal.red[i] = hero;  // 记录 AI 识别的英雄名
        }
      });
      update.redTeam = redTeam;
    }

    update.ocrOriginalResult = ocrOriginal;

    // 获胜方
    if (data.winner) {
      update.winnerIndex = data.winner === 'blue' ? 0 : 1;
    }

    // 比赛时长
    if (data.duration) {
      update.matchDuration = '' + data.duration;
    }

    // 自动填入日期
    if (!this.data.matchDate) {
      update.matchDate = new Date().toISOString().slice(0, 10);
    }

    this.setData(update);

    // 统计识别到的选手数
    const blueCount = (data.blue || []).filter(p => p.hero || p.name).length;
    const redCount = (data.red || []).filter(p => p.hero || p.name).length;

    // 识别出的名字尝试匹配已有选手，显示 nick
    const players = DB.loadPlayers();
    for (const side of ['blueTeam', 'redTeam']) {
      const team = update[side];
      if (!team) continue;
      team.forEach(p => {
        if (!p.name) return;
        // 精确匹配
        const profile = players[p.name];
        if (profile && profile.nick) {
          p.displayName = profile.nick;
          return;
        }
        // 模糊匹配（截断名前缀匹配）
        for (const [id, prof] of Object.entries(players)) {
          if (prof.nick && (id.startsWith(p.name.replace(/\.{2,}$/, '').replace(/#\d*\.{0,}$/, '').trim()) ||
              p.name.replace(/\.{2,}$/, '').replace(/#\d*\.{0,}$/, '').trim().startsWith(id.slice(0, 3)))) {
            p.displayName = prof.nick;
            break;
          }
        }
      });
    }

    wx.showToast({ title: `已识别 ${blueCount + redCount} 名选手`, icon: 'success', duration: 2000 });
    wx.vibrateShort({ type: 'medium' });
  },

  /**
   * 压缩图片，返回 base64（不含 data:image 前缀）
   */
  _compressImage(src) {
    return new Promise((resolve, reject) => {
      wx.getImageInfo({
        src,
        success: (info) => {
          const maxW = 1600;  // 截图需要更高分辨率保留文字细节
          let w = info.width, h = info.height;
          if (w > maxW) { h = Math.round(h * maxW / w); w = maxW; }

          // 使用离屏 canvas 压缩
          const canvas = wx.createOffscreenCanvas({ type: '2d', width: w, height: h });
          const ctx = canvas.getContext('2d');
          const img = canvas.createImage();
          img.onload = () => {
            ctx.drawImage(img, 0, 0, w, h);
            try {
              const dataURL = canvas.toDataURL('image/jpeg', 0.85);
              resolve(dataURL.replace(/^data:image\/\w+;base64,/, ''));
            } catch (e) {
              this._readFileBase64(src).then(resolve).catch(reject);
            }
          };
          img.onerror = () => this._readFileBase64(src).then(resolve).catch(reject);
          img.src = src;
        },
        fail: () => this._readFileBase64(src).then(resolve).catch(reject)
      });
    });
  },

  /** 降级：直接读取文件为 base64 */
  _readFileBase64(src) {
    return new Promise((resolve, reject) => {
      try {
        const fs = wx.getFileSystemManager();
        resolve(fs.readFileSync(src, 'base64'));
      } catch (e) { reject(e); }
    });
  },

  /**
   * 调用云函数进行截图识别（走云开发，无需配置地址）
   */
  _callVisionAPI(base64) {
    // 获取纠错记忆摘要，传给云函数注入 prompt
    const corrections = DB.getCorrectionSummary();
    return new Promise((resolve, reject) => {
      wx.cloud.callFunction({
        name: 'lol-analyze',
        data: {
          image: base64,
          correctionMemory: corrections.length > 0 ? corrections : undefined
        },
        timeout: 60000,
        success: (res) => {
          if (res.result && res.result.success) {
            resolve(res.result.data);
          } else {
            const errMsg = res.result?.error || '识别失败';
            reject(new Error(errMsg));
          }
        },
        fail: (err) => {
          reject(new Error(err.errMsg || '云函数调用失败'));
        }
      });
    });
  },

  /**
   * 模糊匹配英雄名到标准英雄池
   * 大模型返回的英雄名可能和本地英雄池略有差异
   */
  _matchHero(text) {
    if (!text || text.length < 1) return null;
    const exact = ALL_HEROES.find(h => h === text);
    if (exact) return exact;
    const fuzzy = ALL_HEROES.find(h => h.includes(text) || text.includes(h));
    if (fuzzy) return fuzzy;
    if (text.length >= 2) {
      const partial = ALL_HEROES.find(h => h.startsWith(text.slice(0, 2)));
      if (partial) return partial;
    }
    return null;
  },

  onDateChange(e) { this.setData({ matchDate: e.detail.value }); },
  onDurationInput(e) { this.setData({ matchDuration: e.detail.value }); },
  onWinnerChange(e) { this.setData({ winnerIndex: parseInt(e.detail.value) }); },
  onTagInput(e) { this.setData({ matchTag: e.detail.value }); },

  // ---- 英雄搜索 ----
  onHeroInput(e) {
    const { side, index } = e.currentTarget.dataset;
    const val = e.detail.value.trim();
    const key = side === 'blue' ? 'blueTeam' : 'redTeam';
    const team = [...this.data[key]];
    team[index] = { ...team[index], hero: val };
    const update = { [key]: team };
    if (val) {
      update.heroSuggestions = ALL_HEROES.filter(h => h.includes(val)).slice(0, 8);
      update.heroSugSide = side;
      update.heroSugIndex = index;
    } else {
      update.heroSuggestions = [];
    }
    this.setData(update);
  },
  onHeroFocus(e) {
    const { side, index } = e.currentTarget.dataset;
    this.setData({ heroSugSide: side, heroSugIndex: index });
  },
  onHeroBlur() { setTimeout(() => this.setData({ heroSuggestions: [] }), 200); },
  selectHero(e) {
    const { hero, side, index } = e.currentTarget.dataset;
    const key = side === 'blue' ? 'blueTeam' : 'redTeam';
    const team = [...this.data[key]];
    team[index] = { ...team[index], hero };
    this.setData({ [key]: team, heroSuggestions: [] });
  },

  // ---- 选手搜索 ----
  onNameInput(e) {
    const { side, index } = e.currentTarget.dataset;
    const val = e.detail.value.trim();
    const key = side === 'blue' ? 'blueTeam' : 'redTeam';
    const team = [...this.data[key]];
    team[index] = { ...team[index], name: val };
    const update = { [key]: team };
    if (val) {
      const players = DB.loadPlayers();
      const historyNames = DB.getAllPlayerNames();
      const allNames = new Map();
      Object.values(players).forEach(p => {
        allNames.set(p.id, p.nick || '');
        if (p.nick) allNames.set(p.nick, '→ ' + p.id);
      });
      historyNames.forEach(n => { if (!allNames.has(n)) allNames.set(n, ''); });
      update.nameSuggestions = [...allNames.entries()]
        .filter(([name]) => name.toLowerCase().includes(val.toLowerCase()))
        .slice(0, 8).map(([name, hint]) => ({ name, hint }));
      update.nameSugSide = side;
      update.nameSugIndex = index;
    } else {
      update.nameSuggestions = [];
    }
    this.setData(update);
  },
  onNameFocus(e) {
    const { side, index } = e.currentTarget.dataset;
    this.setData({ nameSugSide: side, nameSugIndex: index });
  },
  onNameBlur() { setTimeout(() => this.setData({ nameSuggestions: [] }), 200); },
  selectName(e) {
    const { name, side, index } = e.currentTarget.dataset;
    const key = side === 'blue' ? 'blueTeam' : 'redTeam';
    const team = [...this.data[key]];
    const sug = this.data.nameSuggestions.find(s => s.name === name);
    let finalName = name;
    if (sug && sug.hint && sug.hint.startsWith('→ ')) finalName = sug.hint.slice(2).trim();
    team[index] = { ...team[index], name: finalName };
    this.setData({ [key]: team, nameSuggestions: [] });
  },

  // ---- KDA ----
  onKdaInput(e) {
    const { side, index, field } = e.currentTarget.dataset;
    const key = side === 'blue' ? 'blueTeam' : 'redTeam';
    const team = [...this.data[key]];
    team[index] = { ...team[index], [field]: e.detail.value };
    this.setData({ [key]: team });
  },

  // ---- 随机填充 ----
  quickFill() {
    const names = [...TEST_NAMES].sort(() => Math.random() - 0.5);
    const heroes = [...ALL_HEROES].sort(() => Math.random() - 0.5);
    let hi = 0;
    const blue = ROLE_ORDER.map((role, i) => ({
      role, icon: ROLE_ICONS[role], hero: heroes[hi++], name: names[i],
      kills: '' + Math.floor(Math.random() * 15),
      deaths: '' + Math.floor(Math.random() * 12),
      assists: '' + Math.floor(Math.random() * 20)
    }));
    const red = ROLE_ORDER.map((role, i) => ({
      role, icon: ROLE_ICONS[role], hero: heroes[hi++], name: names[5 + i],
      kills: '' + Math.floor(Math.random() * 15),
      deaths: '' + Math.floor(Math.random() * 12),
      assists: '' + Math.floor(Math.random() * 20)
    }));
    this.setData({
      blueTeam: blue, redTeam: red,
      matchDate: new Date().toISOString().slice(0, 10),
      matchDuration: '' + (Math.floor(Math.random() * 30) + 20),
      winnerIndex: Math.random() > 0.5 ? 0 : 1
    });
  },

  // ---- 提交 ----
  submitMatch() {
    const { blueTeam, redTeam, matchDate, matchDuration, winnerIndex, winnerOptions, matchTag, screenshot } = this.data;
    const allPlayers = [...blueTeam, ...redTeam];
    if (allPlayers.some(p => !p.hero || !p.name)) {
      wx.showToast({ title: '请填写所有选手的英雄和ID', icon: 'none' }); return;
    }
    const players = DB.loadPlayers();
    const formatTeam = (team) => team.map(p => {
      let name = p.name.trim();
      const matched = Object.values(players).find(pl => pl.nick === name);
      if (matched) name = matched.id;
      return { role: p.role, hero: p.hero.trim(), name, kills: parseInt(p.kills) || 0, deaths: parseInt(p.deaths) || 0, assists: parseInt(p.assists) || 0 };
    });
    const blue = formatTeam(blueTeam);
    const red = formatTeam(redTeam);
    const match = {
      id: 'm_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6),
      date: matchDate || new Date().toISOString().slice(0, 10),
      duration: parseInt(matchDuration) || 30,
      winner: winnerOptions[winnerIndex].value,
      blue, red, tag: matchTag.trim(), timestamp: Date.now()
    };
    [...blue, ...red].forEach(p => {
      if (!players[p.name]) {
        DB.addPlayer({ id: p.name, nick: '', roles: [p.role], signatureHeroes: [], note: '', createdAt: Date.now() });
      } else {
        const profile = players[p.name];
        if (!profile.roles.includes(p.role)) { profile.roles.push(p.role); DB.addPlayer(profile); }
      }
    });
    DB.addMatch(match);

    // === 纠错记忆：对比 AI 原始识别 vs 用户最终提交，记录差异 ===
    const ocrOrig = this.data.ocrOriginalResult;
    if (ocrOrig) {
      let correctionCount = 0;
      ['blue', 'red'].forEach(side => {
        const team = side === 'blue' ? blueTeam : redTeam;
        const originals = ocrOrig[side] || [];
        team.forEach((p, i) => {
          const aiHero = originals[i];
          const userHero = p.hero.trim();
          if (aiHero && userHero && aiHero !== userHero) {
            DB.addCorrection(aiHero, userHero);
            correctionCount++;
            console.log(`[纠错记忆] AI识别"${aiHero}" → 用户更正为"${userHero}"`);
          }
        });
      });
      if (correctionCount > 0) {
        wx.showToast({ title: `✅ 已保存，记住${correctionCount}处纠正`, icon: 'none', duration: 2500 });
      } else {
        wx.showToast({ title: '✅ 战绩已保存！', icon: 'none' });
      }
    } else {
      wx.showToast({ title: '✅ 战绩已保存！', icon: 'none' });
    }

    this.setData({ screenshot: '', ocrStatus: '', ocrOriginalResult: null, matchTag: '', blueTeam: makeTeam(), redTeam: makeTeam(), matchDuration: '' });
    this._renderHistoryList();
    this._renderHistoryStats();
    wx.vibrateShort({ type: 'medium' });
  },

  // =========================================================
  //                    选手模块
  // =========================================================
  _renderPlayerCards() {
    const players = DB.loadPlayers();
    const names = Object.keys(players);
    if (names.length === 0) { this.setData({ playerCards: [] }); return; }
    const seen = new Set();
    const cards = names.map(id => {
      const stats = DB.getPlayerStats(id);
      if (stats.games === 0) return null;  // 过滤无战绩的空档案
      // 去重：同一选手可能有多个别名指向同一人
      const key = id.toLowerCase();
      if (seen.has(key)) return null;
      seen.add(key);
      const profile = players[id];
      const initial = (profile.nick || id).charAt(0).toUpperCase();
      const carry = Math.min(100, Math.round((stats.kills / stats.games) * 15));
      const stable = Math.min(100, Math.round(stats.winrate * 1.1));
      const team = Math.min(100, Math.round((stats.assists / stats.games) * 12));
      const aggro = Math.min(100, Math.round(((stats.kills + stats.deaths) / stats.games) * 8));
      return { id, initial, nick: profile.nick, games: stats.games, wins: stats.wins, losses: stats.losses, avgKDA: stats.avgKDA, winrate: stats.winrate, carry, stable, team, aggro };
    }).filter(Boolean).sort((a, b) => b.games - a.games);
    this.setData({ playerCards: cards });
  },

  toggleAddForm() { this.setData({ showAddForm: !this.data.showAddForm }); },
  onNewId(e) { this.setData({ newId: e.detail.value }); },
  onNewNick(e) { this.setData({ newNick: e.detail.value }); },
  onNewHeroes(e) { this.setData({ newHeroes: e.detail.value }); },
  onNewNote(e) { this.setData({ newNote: e.detail.value }); },
  savePlayer() {
    const id = this.data.newId.trim();
    if (!id) { wx.showToast({ title: '请填写选手ID', icon: 'none' }); return; }
    const heroes = this.data.newHeroes.split(/[,，]/).map(s => s.trim()).filter(Boolean);
    DB.addPlayer({ id, nick: this.data.newNick.trim(), roles: [], signatureHeroes: heroes, note: this.data.newNote.trim(), createdAt: Date.now() });
    this.setData({ showAddForm: false, newId: '', newNick: '', newHeroes: '', newNote: '' });
    this._renderPlayerCards();
    wx.showToast({ title: '✅ 选手已保存', icon: 'none' });
  },
  showPlayerDetail(e) {
    const id = e.currentTarget.dataset.id;
    const profile = DB.getPlayer(id) || { id, nick: '', roles: [], signatureHeroes: [] };
    const stats = DB.getPlayerStats(id);
    let streakText = '-';
    if (stats.currentStreak.count > 0) {
      streakText = stats.currentStreak.type === 'W' ? stats.currentStreak.count + '连胜 🔥' : stats.currentStreak.count + '连败 💀';
    }
    this.setData({
      showDetail: true, detailPlayerId: id,
      detailTitle: id + (profile.nick ? ' (' + profile.nick + ')' : '') + ' 的档案',
      detailStats: { ...stats, streakText },
      detailNote: profile.note || '',
      detailNick: profile.nick || '',
      detailHeroes: stats.topHeroes.map(([hero, count]) => ({ hero, count })),
      detailMatches: stats.recentMatches.slice(0, 20).map(m => ({ ...m }))
    });
  },
  closeDetail() { this.setData({ showDetail: false }); },
  preventBubble() {},
  // ---- 选手身份编辑 ----
  onDetailNickInput(e) { this.setData({ detailNick: e.detail.value }); },
  savePlayerIdentity() {
    const id = this.data.detailPlayerId;
    const profile = DB.getPlayer(id);
    if (!profile) return;
    profile.nick = this.data.detailNick.trim();
    DB.addPlayer(profile);
    this.setData({ detailTitle: id + (profile.nick ? ' (' + profile.nick + ')' : '') + ' 的档案' });
    this._renderPlayerCards();
    wx.showToast({ title: '✅ 已保存', icon: 'none' });
  },

  deleteCurrentPlayer() {
    const id = this.data.detailPlayerId;
    wx.showModal({
      title: '确认删除', content: '确定删除 ' + id + ' 的档案？',
      success: (res) => {
        if (res.confirm) { DB.deletePlayer(id); this.setData({ showDetail: false }); this._renderPlayerCards(); }
      }
    });
  },

  // =========================================================
  //                    点评模块
  // =========================================================
  _refreshReviewSelectors() {
    const matches = DB.loadMatches();
    this._allMatches = matches;
    // 生成快捷选手标签（取最近活跃的前6位选手）
    const playerNames = DB.getAllPlayerNames();
    const quickPlayerTags = playerNames.slice(0, 6).map(name => {
      const p = DB.getPlayer(name);
      return { name: p && p.nick ? p.nick : name, id: name };
    });
    this.setData({ quickPlayerTags });
  },

  onReviewPromptInput(e) {
    this.setData({ reviewPrompt: e.detail.value });
  },

  /**
   * 自然语言意图解析 → 查找战绩 → 生成毒舌点评
   */
  generateSmartReview() {
    const prompt = (this.data.reviewPrompt || '').trim();
    if (!prompt && this.data.hasResult) {
      // 无输入但已有结果 → 重新生成当前点评
      this._regenCurrentReview();
      return;
    }
    if (!prompt) {
      wx.showToast({ title: '请输入你想点评的内容', icon: 'none' });
      return;
    }

    const matches = DB.loadMatches();
    if (matches.length === 0) {
      wx.showToast({ title: '暂无比赛数据', icon: 'none' });
      return;
    }

    // 解析意图
    const intent = this._parseReviewIntent(prompt);

    if (intent.type === 'player') {
      this._reviewByPlayer(intent);
    } else if (intent.type === 'recent') {
      this._reviewRecent(intent.count || 1);
    } else if (intent.type === 'week') {
      this._reviewThisWeek();
    } else {
      // 默认：尝试匹配选手，否则点评最近一场
      this._reviewRecent(1);
    }
  },

  /**
   * 解析用户自然语言输入的意图
   */
  _parseReviewIntent(text) {
    const playerNames = DB.getAllPlayerNames();
    const players = DB.loadPlayers();

    // 尝试匹配选手名（ID 或 nick）
    let matchedPlayer = null;
    for (const name of playerNames) {
      if (text.includes(name)) { matchedPlayer = name; break; }
      const profile = players[name];
      if (profile && profile.nick && text.includes(profile.nick)) { matchedPlayer = name; break; }
    }

    // 匹配时间关键词
    const isWeek = /本周|这周|这一周|周报/.test(text);
    const isRecent = /最近|上一[把场局]|刚[才刚]/.test(text);
    const countMatch = text.match(/最近\s*(\d+)\s*[场把局]/);
    const count = countMatch ? parseInt(countMatch[1]) : null;

    // 匹配英雄名
    let matchedHero = null;
    for (const hero of ALL_HEROES) {
      if (text.includes(hero)) { matchedHero = hero; break; }
    }

    if (matchedPlayer) {
      return { type: 'player', name: matchedPlayer, hero: matchedHero, count: count || null, isWeek };
    }
    if (isWeek) return { type: 'week' };
    if (isRecent || count) return { type: 'recent', count: count || 1 };
    return { type: 'fallback' };
  },

  /** 按选手生成点评 */
  _reviewByPlayer(intent) {
    const { name, hero, count, isWeek } = intent;
    let matches;

    if (isWeek) {
      const today = new Date();
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay() + 1);
      matches = DB.getMatchesByDateRange(weekStart.toISOString().slice(0, 10), today.toISOString().slice(0, 10))
        .filter(m => [...m.blue, ...m.red].some(p => p.name === name));
    } else if (count) {
      matches = DB.getMatchesByPlayer(name, count);
    } else {
      matches = DB.getMatchesByPlayer(name);
    }

    // 如果指定了英雄，进一步过滤
    if (hero) {
      matches = matches.filter(m => [...m.blue, ...m.red].some(p => p.name === name && p.hero === hero));
    }

    if (matches.length === 0) {
      wx.showToast({ title: '没找到该选手的比赛记录', icon: 'none' });
      return;
    }

    const profile = DB.getPlayer(name);
    const label = (profile && profile.nick ? profile.nick : name) + (hero ? ' · ' + hero : '');

    this.setData({
      hasResult: true,
      reviewType: 'player',
      reviewLabel: label,
      playerReview: generatePlayerReview(name, matches, 'toxic'),
      _lastReviewIntent: { type: 'player', name, hero, count, isWeek }
    });
  },

  /** 点评最近N场 */
  _reviewRecent(count) {
    const matches = DB.loadMatches().slice(0, count);
    if (matches.length === 0) {
      wx.showToast({ title: '暂无比赛记录', icon: 'none' });
      return;
    }
    this.setData({
      hasResult: true,
      reviewType: 'match',
      reviewLabel: count === 1 ? '最近一场' : '最近 ' + count + ' 场',
      reviewResults: matches.map(m => generateMatchReview(m, 'toxic')),
      _lastReviewIntent: { type: 'recent', count }
    });
  },

  /** 点评本周战绩 */
  _reviewThisWeek() {
    const today = new Date();
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay() + 1);
    const from = weekStart.toISOString().slice(0, 10);
    const to = today.toISOString().slice(0, 10);
    const matches = DB.getMatchesByDateRange(from, to);
    if (matches.length === 0) {
      wx.showToast({ title: '本周暂无比赛', icon: 'none' });
      return;
    }
    this.setData({
      hasResult: true,
      reviewType: 'match',
      reviewLabel: '本周 (' + from + ' ~ ' + to + ')',
      reviewResults: matches.map(m => generateMatchReview(m, 'toxic')),
      _lastReviewIntent: { type: 'week' }
    });
  },

  /** 重新生成当前点评 */
  _regenCurrentReview() {
    const intent = this.data._lastReviewIntent;
    if (!intent) {
      this._reviewRecent(1);
      return;
    }
    if (intent.type === 'player') this._reviewByPlayer(intent);
    else if (intent.type === 'week') this._reviewThisWeek();
    else this._reviewRecent(intent.count || 1);
  },

  /** 快捷标签点击 */
  quickReview(e) {
    const { type, name } = e.currentTarget.dataset;
    if (type === 'latest') {
      this._reviewRecent(1);
    } else if (type === 'week') {
      this._reviewThisWeek();
    } else if (type === 'player' && name) {
      // 通过快捷标签中的 id 找到真实选手名
      const tag = this.data.quickPlayerTags.find(t => t.name === name);
      const realName = tag ? tag.id : name;
      this._reviewByPlayer({ type: 'player', name: realName });
    }
  },

  copyReviewResult() {
    let text = '';
    if (this.data.reviewType === 'match') {
      text = this.data.reviewResults.map(r => {
        let s = r.summary + '\n';
        r.players.forEach(p => { s += p.text + '\n'; if (p.memText) s += p.memText + '\n'; });
        return s;
      }).join('\n---\n');
    } else if (this.data.reviewType === 'player' && this.data.playerReview) {
      text = this.data.playerReview.summary + '\n';
      this.data.playerReview.matchNotes.forEach(n => { text += n.text + '\n'; });
    }
    wx.setClipboardData({ data: text, success: () => wx.showToast({ title: '已复制', icon: 'none' }) });
  },

  // =========================================================
  //                    小程序分享
  // =========================================================
  onShareAppMessage(e) {
    const shareType = e.target && e.target.dataset ? e.target.dataset.shareType : '';

    // 选手名片分享
    if (shareType === 'player') {
      const id = this.data.detailPlayerId;
      const profile = DB.getPlayer(id) || {};
      const stats = this.data.detailStats;
      const nick = profile.nick ? '(' + profile.nick + ')' : '';
      return {
        title: '🎮 ' + id + nick + ' | ' + stats.games + '场 胜率' + stats.winrate + '% KDA ' + stats.avgKDA,
        path: '/pages/analysis/analysis?tab=players&player=' + encodeURIComponent(id),
        imageUrl: '' // 可后续设置自定义分享图
      };
    }

    // 点评结果分享
    if (shareType === 'review') {
      let title = '🐍 毒舌点评';
      if (this.data.reviewType === 'match' && this.data.reviewResults.length > 0) {
        title = '🐍 ' + (this.data.reviewResults[0].summary || '').slice(0, 40);
      } else if (this.data.reviewType === 'player' && this.data.playerReview) {
        title = '🐍 ' + (this.data.playerReview.summary || '').slice(0, 40);
      }
      return {
        title,
        path: '/pages/analysis/analysis?tab=review',
        imageUrl: ''
      };
    }

    // 默认分享
    return {
      title: '🥦 西兰花LOL · 内战战绩记录与分析',
      path: '/pages/analysis/analysis'
    };
  },

  // =========================================================
  //                    历史模块（内嵌在录入Tab下方）
  // =========================================================
  toggleMatchExpand(e) {
    const id = e.currentTarget.dataset.id;
    this.setData({ expandedMatchId: this.data.expandedMatchId === id ? '' : id });
  },

  onHistorySearch(e) {
    this.setData({ historyFilter: e.detail.value.trim() });
    this._renderHistoryList();
  },

  _renderHistoryList() {
    const filter = this.data.historyFilter.toLowerCase();
    let all = DB.loadMatches();
    if (filter) {
      all = all.filter(m => {
        const text = [...m.blue, ...m.red].map(p => p.name + ' ' + p.hero).join(' ') + ' ' + (m.tag || '');
        return text.toLowerCase().includes(filter);
      });
    }
    const list = all.map(m => ({
      ...m,
      blue: m.blue.map(p => ({ ...p, displayName: DB.getDisplayName(p.name) })),
      red: m.red.map(p => ({ ...p, displayName: DB.getDisplayName(p.name) }))
    }));
    this.setData({ matchList: list });
  },

  _renderHistoryStats() {
    const all = DB.loadMatches();
    const playerNames = DB.getAllPlayerNames();
    const totalKills = all.reduce((sum, m) => sum + [...m.blue, ...m.red].reduce((s, p) => s + (p.kills || 0), 0), 0);
    this.setData({ totalGames: all.length, totalPlayers: playerNames.length, totalKills });
  },

  previewImage(e) {
    const src = e.currentTarget.dataset.src;
    if (src) wx.previewImage({ urls: [src], current: src });
  },

  deleteMatch(e) {
    const id = e.currentTarget.dataset.id;
    wx.showModal({
      title: '提示', content: '确定删除这场比赛记录？',
      success: (res) => {
        if (res.confirm) {
          DB.deleteMatch(id);
          this._renderHistoryList();
          this._renderHistoryStats();
          wx.showToast({ title: '已删除', icon: 'success' });
        }
      }
    });
  },

  clearAll() {
    const all = DB.loadMatches();
    if (all.length === 0) { wx.showToast({ title: '暂无数据', icon: 'none' }); return; }
    wx.showModal({
      title: '⚠️ 危险操作', content: '确定清空所有历史战绩？此操作不可撤销！', confirmColor: '#ef4444',
      success: (res) => {
        if (res.confirm) {
          DB.clearMatches();
          this._renderHistoryList();
          this._renderHistoryStats();
          this.setData({ awards: [], awardsEmpty: false });
          wx.showToast({ title: '已清空', icon: 'success' });
        }
      }
    });
  },

  exportData() {
    const json = DB.exportAll();
    const fs = wx.getFileSystemManager();
    const filePath = `${wx.env.USER_DATA_PATH}/xlh_backup_${Date.now()}.json`;
    fs.writeFileSync(filePath, json, 'utf8');
    wx.shareFileMessage({
      filePath,
      success() { wx.showToast({ title: '导出成功', icon: 'success' }); },
      fail() {
        wx.setClipboardData({ data: json, success() { wx.showToast({ title: '已复制到剪贴板', icon: 'success' }); } });
      }
    });
  },

  importData() {
    wx.chooseMessageFile({
      count: 1, type: 'file', extension: ['json'],
      success: (res) => {
        const tempPath = res.tempFiles[0].path;
        const fs = wx.getFileSystemManager();
        try {
          const content = fs.readFileSync(tempPath, 'utf8');
          if (DB.importAll(content)) {
            wx.showToast({ title: '导入成功', icon: 'success' });
            this._renderHistoryList();
            this._renderHistoryStats();
          } else {
            wx.showToast({ title: '导入失败', icon: 'none' });
          }
        } catch (err) {
          wx.showToast({ title: '读取文件失败', icon: 'none' });
        }
      }
    });
  },

  onWeekChange(e) { this.setData({ weekIdx: parseInt(e.detail.value) }); },

  generateAwards() {
    const weekType = this.data.weekOptions[this.data.weekIdx].value;
    const today = new Date();
    let from, to;
    if (weekType === 'this') {
      const weekStart = new Date(today);
      weekStart.setDate(today.getDate() - today.getDay() + 1);
      from = weekStart.toISOString().slice(0, 10);
      to = today.toISOString().slice(0, 10);
    } else {
      const lastWeekEnd = new Date(today);
      lastWeekEnd.setDate(today.getDate() - today.getDay());
      const lastWeekStart = new Date(lastWeekEnd);
      lastWeekStart.setDate(lastWeekEnd.getDate() - 6);
      from = lastWeekStart.toISOString().slice(0, 10);
      to = lastWeekEnd.toISOString().slice(0, 10);
    }
    const matches = DB.getMatchesByDateRange(from, to);
    if (matches.length === 0) { this.setData({ awards: [], awardsEmpty: true }); return; }

    const playerData = {};
    matches.forEach(match => {
      [...match.blue, ...match.red].forEach(p => {
        const side = match.blue.some(bp => bp.name === p.name && bp.hero === p.hero) ? 'blue' : 'red';
        const isWin = match.winner === side;
        if (!playerData[p.name]) playerData[p.name] = { kills: 0, deaths: 0, assists: 0, wins: 0, games: 0, kdaScores: [] };
        const pd = playerData[p.name];
        pd.kills += p.kills; pd.deaths += p.deaths; pd.assists += p.assists; pd.games++;
        if (isWin) pd.wins++;
        pd.kdaScores.push(p.deaths > 0 ? (p.kills + p.assists) / p.deaths : (p.kills + p.assists) * 1.5);
      });
    });

    const entries = Object.entries(playerData).map(([name, d]) => ({
      name, ...d,
      winrate: d.games > 0 ? Math.round((d.wins / d.games) * 100) : 0,
      avgKDA: d.deaths > 0 ? ((d.kills + d.assists) / d.deaths).toFixed(2) : 'Perfect',
      avgKdaNum: d.kdaScores.reduce((a, b) => a + b, 0) / d.kdaScores.length,
      killsPerGame: (d.kills / d.games).toFixed(1),
      assistsPerGame: (d.assists / d.games).toFixed(1)
    }));

    function variance(arr) {
      if (arr.length <= 1) return 0;
      const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
      return arr.reduce((sum, v) => sum + (v - mean) ** 2, 0) / arr.length;
    }

    const mvp = [...entries].sort((a, b) => (b.avgKdaNum * 0.5 + b.winrate * 0.3 + b.games * 2) - (a.avgKdaNum * 0.5 + a.winrate * 0.3 + a.games * 2))[0];
    const blackhole = [...entries].sort((a, b) => (a.avgKdaNum * 0.5 + a.winrate * 0.3) - (b.avgKdaNum * 0.5 + b.winrate * 0.3))[0];
    const killer = [...entries].sort((a, b) => b.kills - a.kills)[0];
    const assistKing = [...entries].sort((a, b) => b.assists - a.assists)[0];
    const stablePlayer = [...entries].filter(e => e.games >= 2).sort((a, b) => variance(a.kdaScores) - variance(b.kdaScores))[0] || entries[0];
    const improver = [...entries].sort((a, b) => b.winrate - a.winrate)[Math.min(1, entries.length - 1)] || entries[0];

    const awards = [
      { type: 'mvp', icon: '👑', title: '周 MVP', winner: mvp?.name, desc: '综合表现最出色', stats: mvp ? mvp.games + '场 · 胜率' + mvp.winrate + '% · KDA ' + mvp.avgKDA : '' },
      { type: 'blackhole', icon: '🕳️', title: '游戏黑洞', winner: blackhole?.name, desc: '呃...还有进步空间', stats: blackhole ? blackhole.games + '场 · 胜率' + blackhole.winrate + '% · KDA ' + blackhole.avgKDA : '' },
      { type: 'killer', icon: '⚔️', title: '击杀王', winner: killer?.name, desc: '人头收割机', stats: killer ? '总击杀 ' + killer.kills + ' · 场均 ' + killer.killsPerGame : '' },
      { type: 'assist', icon: '🤝', title: '助攻王', winner: assistKing?.name, desc: '最强辅助之心', stats: assistKing ? '总助攻 ' + assistKing.assists + ' · 场均 ' + assistKing.assistsPerGame : '' },
      { type: 'stable', icon: '🧘', title: '最稳定', winner: stablePlayer?.name, desc: '波动最小，稳如老狗', stats: stablePlayer ? stablePlayer.games + '场 · KDA ' + stablePlayer.avgKDA : '' },
      { type: 'improver', icon: '📈', title: '潜力股', winner: improver?.name, desc: '未来可期', stats: improver ? '胜率 ' + improver.winrate + '% · ' + improver.games + '场' : '' }
    ].filter(a => a.winner);

    this.setData({ awards, awardsEmpty: false });
  }
});
