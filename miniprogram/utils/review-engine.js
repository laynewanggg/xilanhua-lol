/* AI 点评引擎 */
const { DB, ROLE_ICONS } = require('./db');

function randPick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function fillTpl(tpl, data) { return tpl.replace(/\{(\w+)\}/g, (_, k) => data[k] != null ? data[k] : ''); }

const TEMPLATES = {
  toxic: {
    summary: {
      blueWin: [
        "蓝色方赢了，别高兴太早——{mvp}一个人carry全场，其他人基本在旅游。红色方建议回去练人机。",
        "这把蓝色方赢得轻松，红色方是不是有人在摸鱼？{duration}分钟就够红色方怀疑人生了。",
        "蓝色方拿下比赛。不过看KDA分布，蓝色方里也有人是被抬着上去的吧？"
      ],
      redWin: [
        "红色方翻盘！蓝色方的优势就像他们的走位——根本不存在。{mvp}全场发力。",
        "红色方赢了这场{duration}分钟的'慈善赛'。蓝色方是故意放水还是真就这水平？",
        "红色方获胜。蓝色方{svp}你是付费演员吗？对面都要发工资感谢你了。"
      ]
    },
    player: {
      carry: [
        "全场最佳，{name}一个人把队友从坑里拉出来。{hero}打出{kda}的KDA，唯一看得下去的人。",
        "{name}的{hero}一骑当千！{kills}个击杀{assists}次助攻，可惜队友配不上你。"
      ],
      feeder: [
        "{name}你是对面请来的内鬼吗？{hero}打出{kda}，对面ADC要给你发感谢信了。",
        "{name}，{deaths}条命全送了，你在玩送人头模拟器？对面打野要请你吃饭了。"
      ],
      average: [
        "{name}全场划水，{hero}打出{kda}，存在感约等于隐身了。",
        "{name}你在这把干了啥？{kda}的数据不好不坏，典型的'蹭赢'体质。"
      ],
      kingStealer: [
        "{name}你这个抢人头狂魔！{kills}个击杀{assists}次助攻，每个技能都精准收割，太阴了。"
      ]
    },
    memory: {
      winStreak: ["📊 {name}已经连胜{count}场了，建议对面直接ban掉这个人。"],
      loseStreak: ["📊 {name}已经连败{count}场了，建议去洗个脸清醒一下。"],
      sameHero: ["📊 {name}用{hero}打了{count}场，胜率{winrate}%。{comment}"],
      sameHeroComment: { high: "本命无疑了，别太飘。", low: "这胜率...不如换一个？", mid: "凑合吧。" },
    },
    playerSummary: [
      "关于{name}：历史{games}场，胜率{winrate}%，平均KDA {avgKDA}。{streakText}。常用英雄：{topHeroes}。{comment}",
    ],
    playerComment: { high: "表现相当稳定，但也别飘了——一飘就翻车。", low: "说实话，你的数据有点触目惊心，建议回去练练基本功。", mid: "中规中矩，不算拖后腿但也不算carry，平平无奇。" }
  },
  praise: {
    summary: {
      blueWin: [
        "蓝色方完美配合拿下比赛！{mvp}表现惊艳，全队都发挥出了超高水准！",
        "恭喜蓝色方！教科书级别的团队协作，{mvp}闪耀全场！"
      ],
      redWin: [
        "红色方逆风翻盘！{mvp}力挽狂澜，全队的坚持终于得到回报！",
        "恭喜红色方！{mvp}状态爆棚，大家配合越来越默契了！"
      ]
    },
    player: {
      carry: ["{name}今天的{hero}简直无解！{kda}的完美KDA，你就是全场最亮的星！🌟"],
      feeder: ["{name}今天虽然不太顺，但你的勇气值得肯定！下次一定更好！💪"],
      average: ["{name}的{hero}发挥稳健！{kda}很均衡，是团队不可或缺的中坚力量！"],
      kingStealer: ["{name}精准的收割能力令人叹服！这是对伤害的极致理解！"]
    },
    memory: {
      winStreak: ["📊 {name}已经{count}连胜了！状态火热！🔥"],
      loseStreak: ["📊 {name}最近{count}场没赢，相信你马上触底反弹！"],
      sameHero: ["📊 {name}的{hero}打了{count}场，胜率{winrate}%！{comment}"],
      sameHeroComment: { high: "本命英雄无疑！", low: "每一场都是经验，加油！", mid: "正在稳步提升！" },
    },
    playerSummary: [
      "关于{name}：累计{games}场，胜率{winrate}%，平均KDA {avgKDA}。{streakText}。常用英雄：{topHeroes}。{comment}",
    ],
    playerComment: { high: "表现非常出色，继续保持这个状态！", low: "虽然数据还有提升空间，但你的团队精神很棒！", mid: "稳扎稳打，值得信赖的队友！" }
  },
  coach: {
    summary: {
      blueWin: [
        "【赛后分析】蓝色方{duration}分钟完成比赛，节奏把控较好。{mvp}是核心输出点。",
        "【教练点评】蓝方胜利。{mvp}贡献关键输出，团队整体打出合理伤害分配。"
      ],
      redWin: [
        "【赛后分析】红色方赢得比赛。{mvp}发挥稳定，是胜负关键因素。",
        "【教练点评】红方胜利。{mvp}的带节奏能力突出。"
      ]
    },
    player: {
      carry: ["【{name} - {hero}】KDA: {kda}。核心输出，参团率极高。评级：S"],
      feeder: ["【{name} - {hero}】KDA: {kda}。表现不佳，{deaths}次死亡需反思。评级：D"],
      average: ["【{name} - {hero}】KDA: {kda}。中规中矩，建议提高参团率。评级：B"],
      kingStealer: ["【{name}】击杀数据亮眼但助攻偏少，建议适当让经济给核心。评级：A-"]
    },
    memory: {
      winStreak: ["📊 【数据】{name}近{count}场全胜，竞技状态处于巅峰。"],
      loseStreak: ["📊 【数据】{name}近{count}场全败，建议全面复盘。"],
      sameHero: ["📊 【数据】{name}使用{hero}{count}场，胜率{winrate}%。{comment}"],
      sameHeroComment: { high: "可作为核心英雄池保留。", low: "胜率偏低，建议分析问题。", mid: "有提升空间。" },
    },
    playerSummary: [
      "【{name}综合评估】{games}场比赛，胜率{winrate}%，平均KDA {avgKDA}。{streakText}。擅长英雄：{topHeroes}。{comment}",
    ],
    playerComment: { high: "数据优秀，建议保持当前打法。", low: "需要从多个维度进行调整和提升。", mid: "数据中规中矩，有进步空间。" }
  },
  meme: {
    summary: {
      blueWin: [
        "GG！蓝色方赢了这场峡谷相声大赛！{mvp}是今晚的头牌，红色方友情出演'如何优雅地送头'。",
        "蓝色方win！含金量大概相当于超市抢到最后一袋打折薯片。{mvp}是唯一认真的。"
      ],
      redWin: [
        "红色方赢了！蓝色方集体表演'我以为队友会来'系列。{mvp}单handedly按在地上摩擦。",
        "红色方获胜！如果有弹幕的话一定满屏'？？？'。{duration}分钟的离谱之旅。"
      ]
    },
    player: {
      carry: ["{name}的{hero}让我想起一句话：'你不是一个人在战斗——因为队友都死了就剩你了。'{kda}，请收下膝盖🧎"],
      feeder: ["{name}你是不是把LOL和跑跑卡丁车搞混了？全场跑得最快，方向永远是对面泉水。{hero}表示不认识你。"],
      average: ["{name}全场隐身成功！{hero}在玩潜行游戏吗？{kda}就像体检报告——一切正常没啥亮点。"],
      kingStealer: ["{name}装了'最后一刀自动瞄准'插件？{kills}个人头每个精准收割，队友要把你删好友了。"]
    },
    memory: {
      winStreak: ["📊 震惊！{name}{count}连胜！有关部门已介入调查是否使用了'非法好运'。"],
      loseStreak: ["📊 {name}{count}连败！成功解锁成就：'峡谷铁王座'。"],
      sameHero: ["📊 {name}的{hero}使用{count}次，胜率{winrate}%。{comment}"],
      sameHeroComment: { high: "只有这英雄能救你吧？", low: "建议你俩和平分手。", mid: "凑合吧。" },
    },
    playerSummary: [
      "说到{name}——{games}场比赛，胜率{winrate}%，KDA {avgKDA}。{streakText}。本命英雄：{topHeroes}。{comment}",
    ],
    playerComment: { high: "这数据可以，是不是偷偷用了什么秘籍？", low: "这数据...我不好说，你自己品品。", mid: "不功不过，标准的'在但没完全在'。" }
  }
};

function generateMatchReview(match, mode) {
  const T = TEMPLATES[mode];
  const allPlayers = [...match.blue, ...match.red];
  const scored = allPlayers.map(p => {
    const side = match.blue.some(bp => bp.name === p.name && bp.hero === p.hero) ? 'blue' : 'red';
    const isWin = match.winner === side;
    const kda = p.deaths > 0 ? (p.kills + p.assists) / p.deaths : (p.kills + p.assists) * 1.5;
    const score = kda * (isWin ? 1.3 : 1) + p.kills * 0.5 + p.assists * 0.3 - p.deaths * 0.8;
    return { ...p, side, isWin, kda, score };
  });
  scored.sort((a, b) => b.score - a.score);
  const mvp = scored[0], svp = scored[scored.length - 1];

  const winKey = match.winner === 'blue' ? 'blueWin' : 'redWin';
  const summaryText = fillTpl(randPick(T.summary[winKey]), { mvp: mvp.name, svp: svp.name, duration: match.duration });

  const playerReviews = scored.map(p => {
    const kdaStr = p.kills + '/' + p.deaths + '/' + p.assists;
    let type;
    if (p === mvp || (p.kda >= 5 && p.kills >= 5)) type = 'carry';
    else if (p === svp || (p.deaths >= 8 && p.kills <= 2)) type = 'feeder';
    else if (p.kills >= 5 && p.assists <= 2 && p.kills > p.assists * 3) type = 'kingStealer';
    else type = 'average';
    const text = fillTpl(randPick(T.player[type]), { name: p.name, hero: p.hero, kills: p.kills, deaths: p.deaths, assists: p.assists, kda: kdaStr });

    let memText = '';
    const ps = DB.getPlayerStats(p.name);
    if (ps.games > 0) {
      const parts = [];
      if (ps.currentStreak.count >= 2) {
        const k = ps.currentStreak.type === 'W' ? 'winStreak' : 'loseStreak';
        parts.push(fillTpl(randPick(T.memory[k]), { name: p.name, count: ps.currentStreak.count }));
      }
      const hh = DB.getPlayerHeroHistory(p.name, p.hero);
      if (hh.length >= 1) {
        const hw = hh.filter(h => h.win).length;
        const wr = Math.round((hw / hh.length) * 100);
        const ck = wr >= 60 ? 'high' : wr <= 40 ? 'low' : 'mid';
        parts.push(fillTpl(randPick(T.memory.sameHero), { name: p.name, hero: p.hero, count: hh.length, winrate: wr, comment: T.memory.sameHeroComment[ck] }));
      }
      memText = parts.slice(0, 2).join('\n');
    }

    const kdaVal = p.deaths > 0 ? ((p.kills + p.assists) / p.deaths).toFixed(1) : '∞';
    const kdaClass = kdaVal === '∞' || parseFloat(kdaVal) >= 4 ? 'good' : parseFloat(kdaVal) >= 2 ? 'avg' : 'bad';
    return {
      name: p.name, hero: p.hero, role: p.role, side: p.side,
      kdaStr, kdaVal, kdaClass, text, memText,
      isMvp: p === mvp, isSvp: p === svp,
      sideIcon: p.side === 'blue' ? '🔵' : '🔴',
      roleIcon: ROLE_ICONS[p.role] || ''
    };
  });

  return { summary: summaryText, players: playerReviews, matchDate: match.date };
}

function generatePlayerReview(playerName, matches, mode) {
  const T = TEMPLATES[mode];
  const stats = DB.getPlayerStats(playerName);
  const profile = DB.getPlayer(playerName);

  const streakText = stats.currentStreak.count >= 2
    ? (stats.currentStreak.type === 'W' ? '正在' + stats.currentStreak.count + '连胜🔥' : '正在' + stats.currentStreak.count + '连败💀')
    : '近期胜负交替';
  const topHeroes = stats.topHeroes.map(([h, c]) => h + '(' + c + '场)').join('、') || '暂无';
  const commentKey = stats.winrate >= 55 ? 'high' : stats.winrate < 45 ? 'low' : 'mid';

  const summary = fillTpl(randPick(T.playerSummary), {
    name: playerName, games: stats.games, winrate: stats.winrate,
    avgKDA: stats.avgKDA, streakText, topHeroes,
    comment: T.playerComment[commentKey]
  });

  const matchNotes = matches.slice(0, 10).map(m => {
    const p = [...m.blue, ...m.red].find(x => x.name === playerName);
    if (!p) return null;
    const side = m.blue.some(bp => bp.name === p.name && bp.hero === p.hero) ? 'blue' : 'red';
    const isWin = m.winner === side;
    return {
      text: m.date + ' ' + (ROLE_ICONS[p.role] || '') + p.hero + ' ' + p.kills + '/' + p.deaths + '/' + p.assists + ' ' + (isWin ? '✅胜' : '❌败')
    };
  }).filter(Boolean);

  return { summary, matchNotes, type: 'player' };
}

module.exports = { generateMatchReview, generatePlayerReview, TEMPLATES };
