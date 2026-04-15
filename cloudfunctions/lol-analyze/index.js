/**
 * LOL 截图识别云函数（v2 - 两步识别 + 易混淆检测）
 * 功能：接收 base64 图片，调用 Vision API 识别 LOL 战绩
 *
 * 架构：
 *   第一步：AI 初步识别（带易混淆英雄警告）
 *   第二步：对 low/medium 置信度 + 易混淆组合 → 用官方头像精确比对
 *
 * 调用方式（小程序端）：
 *   wx.cloud.callFunction({ name: 'lol-analyze', data: { image: base64String } })
 */

const cloud = require('wx-server-sdk');
cloud.init({ env: cloud.DYNAMIC_CURRENT_ENV });

const db = cloud.database();
const https = require('https');

// Data Dragon 头像 CDN 配置（全局常量，downloadImageWithFallback 需要引用）
const HERO_ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn/14.24.1/img/champion/';
const HERO_ICON_FALLBACK_BASES = [
  'https://ddragon.leagueoflegends.com/cdn/14.23.1/img/champion/',
  'https://ddragon.leagueoflegends.com/cdn/14.22.1/img/champion/',
];

/**
 * 使用原生 https 模块下载图片（避免 CloudBase 运行时 fetch 的 JSON 自动解析问题）
 */
function downloadImageAsBase64(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, { timeout: 10000 }, (res) => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        // 处理重定向
        return downloadImageAsBase64(res.headers.location).then(resolve).catch(reject);
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode}`));
      }
      const chunks = [];
      res.on('data', (chunk) => chunks.push(chunk));
      res.on('end', () => {
        const buf = Buffer.concat(chunks);
        resolve(buf.toString('base64'));
      });
      res.on('error', (e) => reject(e));
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('下载超时')); });
    req.on('error', (e) => reject(e));
  });
}

/**
 * 带多版本 fallback 的头像下载：先尝试主版本，403/404 时自动切换备用 Data Dragon 版本
 */
async function downloadImageWithFallback(heroId) {
  const allUrls = [`${HERO_ICON_BASE}${heroId}.png`];
  for (const fallbackBase of HERO_ICON_FALLBACK_BASES) {
    allUrls.push(`${fallbackBase}${heroId}.png`);
  }
  let lastError;
  for (const url of allUrls) {
    try {
      return await downloadImageAsBase64(url);
    } catch (e) {
      lastError = e;
      console.log(`[lol-analyze]   ↳ ${url} 失败: ${e.message}，尝试下一个版本...`);
    }
  }
  throw lastError || new Error('所有版本均失败');
}

/**
 * 从数据库获取 Vision API 配置
 * 优先 type='vision'，降级 type='ai'
 */
async function getVisionConfig() {
  try {
    const { data: visionData } = await db.collection('config').where({ type: 'vision' }).get();
    if (visionData.length > 0) {
      return {
        baseUrl: visionData[0].baseUrl,
        apiKey: visionData[0].apiKey,
        model: visionData[0].model || 'gpt-4o-mini',
      };
    }

    const { data: aiData } = await db.collection('config').where({ type: 'ai' }).get();
    if (aiData.length > 0) {
      return {
        baseUrl: aiData[0].baseUrl,
        apiKey: aiData[0].apiKey,
        model: aiData[0].visionModel || 'gpt-4o-mini',
      };
    }
  } catch (e) {
    console.error('[lol-analyze] 获取配置失败:', e.message);
  }
  return null;
}

/**
 * 检测图片 MIME 类型
 */
function detectMimeType(base64) {
  if (base64.startsWith('/9j/')) return 'image/jpeg';
  if (base64.startsWith('iVBOR')) return 'image/png';
  if (base64.startsWith('R0lGO')) return 'image/gif';
  if (base64.startsWith('UklGR')) return 'image/webp';
  return 'image/jpeg';
}

/**
 * 带超时的 HTTP 请求
 */
async function fetchWithTimeout(url, options, timeoutMs = 60000) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    if (!response.ok) {
      const errorBody = await response.text().catch(() => '');
      throw new Error(`HTTP ${response.status}: ${errorBody.slice(0, 200)}`);
    }
    return await response.json();
  } catch (error) {
    clearTimeout(timeoutId);
    throw error;
  }
}

/**
 * 中文英雄称号/常用名 -> Data Dragon 英文 ID 映射表
 * 用于从官方 CDN 下载头像图片
 */
function getHeroIdMapping() {
  return {
    // 格式: "中文名": "DataDragonID"
    '黑暗之女': 'Annie', '狂战士': 'Olaf', '正义巨像': 'Galio', '卡牌大师': 'TwistedFate',
    '德邦总管': 'XinZhao', '无畏战车': 'Urgot', '诡术妖姬': 'LeBlanc', '猩红收割者': 'Vladimir',
    '远古恐惧': 'Fiddlesticks', '正义天使': 'Kayle', '无极剑圣': 'MasterYi', '牛头酋长': 'Alistar',
    '符文法师': 'Ryze', '亡灵战神': 'Sion', '战争女神': 'Sivir', '众星之子': 'Soraka',
    '迅捷斥候': 'Teemo', '麦林炮手': 'Tristana', '祖安怒兽': 'Warwick', '雪原双子': 'Nunu',
    '赏金猎人': 'MissFortune', '寒冰射手': 'Ashe', '蛮族之王': 'Tryndamere', '武器大师': 'Jax',
    '堕落天使': 'Morgana', '时光守护者': 'Zilean', '炼金术士': 'Singed', '痛苦之拥': 'Evelynn',
    '瘟疫之源': 'Twitch', '死亡颂唱者': 'Karthus', '虚空恐惧': 'ChoGath', '殇之木乃伊': 'Amumu',
    '披甲龙龟': 'Rammus', '冰晶凤凰': 'Anivia', '恶魔小丑': 'Shaco', '祖安狂人': 'DrMundo',
    '琴瑟仙女': 'Sona', '虚空行者': 'Kassadin', '刀锋舞者': 'Irelia', '风暴之怒': 'Janna',
    '海洋之灾': 'Gangplank', '英勇投弹手': 'Corki', '天启者': 'Karma', '瓦洛兰之盾': 'Taric',
    '邪恶小法师': 'Veigar', '巨魔之王': 'Trundle', '诺克萨斯统领': 'Swain', '皮城女警': 'Caitlyn',
    '蒸汽机器人': 'Blitzcrank', '熔岩巨兽': 'Malphite', '不祥之刃': 'Katarina', '永恒梦魇': 'Nocturne',
    '扭曲树精': 'Maokai', '荒漠屠夫': 'Renekton', '德玛西亚皇子': 'JarvanIV', '蜘蛛女皇': 'Elise',
    '发条魔灵': 'Orianna', '齐天大圣': 'Wukong', '复仇焰魂': 'Brand', '盲僧': 'LeeSin',
    '机械先驱': 'Viktor',
    '暗夜猎手': 'Vayne', '机械公敌': 'Rumble', '魔蛇之拥': 'Cassiopeia', '上古领主': 'Skarner',
    '大发明家': 'Heimerdinger', '沙漠死神': 'Nasus', '狂野女猎手': 'Nidalee', '兽灵行者': 'Udyr',
    '圣锤之毅': 'Poppy', '酒桶': 'Gragas', '不屈之枪': 'Pantheon', '探险家': 'Ezreal',
    '铁铠冥魂': 'Mordekaiser', '牧魂人': 'Yorick', '离群之刺': 'Akali', '狂暴之心': 'Kennen',
    '德玛西亚之力': 'Garen', '曙光女神': 'Leona', '虚空先知': 'Malzahar', '刀锋之影': 'Talon',
    '放逐之刃': 'Riven', '深渊巨口': 'KogMaw', '暮光之眼': 'Shen', '光辉女郎': 'Lux',
    '远古巫灵': 'Xerath', '龙血武姬': 'Shyvana', '九尾妖狐': 'Ahri', '法外狂徒': 'Graves',
    '潮汐海灵': 'Fizz', '不灭狂雷': 'Volibear', '傲之追猎者': 'Rengar', '惩戒之箭': 'Varus',
    '深海泰坦': 'Nautilus', '奥术先驱': 'Viktor', '北地之怒': 'Sejuani', '无双剑姬': 'Fiora',
    '爆破鬼才': 'Ziggs', '仙灵女巫': 'Lulu', '荣耀行刑官': 'Draven', '战争之影': 'Hecarim',
    '虚空掠夺者': 'Khazix', '诺克萨斯之手': 'Darius', '未来守护者': 'Jayce', '冰霜女巫': 'Lissandra',
    '皎月女神': 'Diana', '德玛西亚之翼': 'Quinn', '暗黑元首': 'Syndra', '铸星龙王': 'AurelionSol',
    '影流之镰': 'Kayn', '暮光星灵': 'Zoe', '荆棘之兴': 'Zyra', '虚空之女': 'KaiSa',
    '星籁歌姬': 'Seraphine', '迷失之牙': 'Gnar', '生化魔人': 'Zac', '疾风剑豪': 'Yasuo',
    '虚空之眼': 'VelKoz', '岩雀': 'Taliyah', '青钢影': 'Camille', '影哨': 'Akshan',
    '虚空女皇': 'Belveth', '弗雷尔卓德之心': 'Braum', '戏命师': 'Jhin', '永猎双子': 'Kindred',
    '祖安花火': 'Zeri', '暴走萝莉': 'Jinx', '河流之王': 'TahmKench', '狂厄蔷薇': 'Briar',
    '破败之王': 'Viego', '涤魂圣枪': 'Senna', '圣枪游侠': 'Lucian', '影流之主': 'Zed',
    '暴走骑士': 'Kled', '时间刺客': 'Ekko', '元素女皇': 'Qiyana', '皮城执法官': 'Vi',
    '暗裔剑魔': 'Aatrox', '唤潮鲛姬': 'Nami', '沙漠皇帝': 'Azir', '魔法猫咪': 'Yuumu',
    '沙漠玫瑰': 'Samira', '魂锁典狱长': 'Thresh', '海兽祭司': 'Illaoi', '虚空遁地兽': 'RekSai',
    '翠神': 'Ivern', '复仇之矛': 'Kalista', '星界游神': 'Bard', '幻翎': 'Rakan', '逆羽': 'Xayah',
    '山隐之焰': 'Ornn', '解脱者': 'Sylas', '万花通灵': 'Neeko', '残月之肃': 'Aphelios',
    '镕铁少女': 'Rell', '血港鬼影': 'Pyke', '愁云使者': 'Vex', '封魔剑魂': 'Yone',
    '铁血狼母': 'Ambessa', '流光镜影': 'Mel', '不破之誓': 'Alune', '腕豪': 'Sett',
    '含羞蓓蕾': 'Lillia', '灵罗娃娃': 'Gwen', '炼金男爵': 'Rellita', '双界灵兔': 'Aurora',
    '不羁之悦': 'Nilah', '纳祖芒荣耀': 'Ksante', '炽炎雏鸟': 'Smolder', '明烛': 'Milio',
    '不落魔锋': 'Ahri', '异画师': 'Hwei', '百裂冥犬': 'Nafiri',

    // 常用名映射
    '安妮': 'Annie', '奥拉夫': 'Olaf', '加里奥': 'Galio', '崔斯特': 'TwistedFate',
    '赵信': 'XinZhao', '厄加特': 'Urgot', '乐芙兰': 'LeBlanc', '弗拉基米尔': 'Vladimir',
    '费德提克': 'Fiddlesticks', '凯尔': 'Kayle', '易': 'MasterYi', '阿利斯塔': 'Alistar',
    '瑞兹': 'Ryze', '赛恩': 'Sion', '希维尔': 'Sivir', '索拉卡': 'Soraka',
    '提莫': 'Teemo', '崔丝塔娜': 'Tristana', '沃里克': 'Warwick', '努努': 'Nunu',
    '厄运小姐': 'MissFortune', '艾希': 'Ashe', '泰达米尔': 'Tryndamere', '贾克斯': 'Jax',
    '莫甘娜': 'Morgana', '基兰': 'Zilean', '辛吉德': 'Singed', '伊芙琳': 'Evelynn',
    '图奇': 'Twitch', '卡尔萨斯': 'Karthus', '科加斯': 'ChoGath', '阿木木': 'Amumu',
    '拉莫斯': 'Rammus', '艾尼维亚': 'Anivia', '萨科': 'Shaco', '蒙多医生': 'DrMundo',
    '娑娜': 'Sona', '卡萨丁': 'Kassadin', '艾瑞莉娅': 'Irelia', '迦娜': 'Janna',
    '普朗克': 'Gangplank', '库奇': 'Corki', '卡尔玛': 'Karma', '塔里克': 'Taric',
    '维迦': 'Veigar', '特朗德尔': 'Trundle', '斯维因': 'Swain', '凯特琳': 'Caitlyn',
    '布里茨': 'Blitzcrank', '墨菲特': 'Malphite', '卡特琳娜': 'Katarina', '魔腾': 'Nocturne',
    '茂凯': 'Maokai', '雷克顿': 'Renekton', '嘉文四世': 'JarvanIV', '伊莉丝': 'Elise',
    '奥莉安娜': 'Orianna', '孙悟空': 'Wukong', '布兰德': 'Brand', '李青': 'LeeSin',
    '维克托': 'Viktor',
    '薇恩': 'Vayne', '兰博': 'Rumble', '卡西奥佩娅': 'Cassiopeia', '斯卡纳': 'Skarner',
    '黑默丁格': 'Heimerdinger', '内瑟斯': 'Nasus', '奈德丽': 'Nidalee', '乌迪尔': 'Udyr',
    '波比': 'Poppy', '古拉加斯': 'Gragas', '潘森': 'Pantheon', '伊泽瑞尔': 'Ezreal',
    '莫德凯撒': 'Mordekaiser', '约里克': 'Yorick', '阿卡丽': 'Akali', '凯南': 'Kennen',
    '盖伦': 'Garen', '蕾欧娜': 'Leona', '玛尔扎哈': 'Malzahar', '泰隆': 'Talon',
    '锐雯': 'Riven', '克格莫': 'KogMaw', '慎': 'Shen', '拉克丝': 'Lux',
    '泽拉斯': 'Xerath', '希瓦娜': 'Shyvana', '阿狸': 'Ahri', '格雷福斯': 'Graves',
    '菲兹': 'Fizz', '沃利贝尔': 'Volibear', '雷恩加尔': 'Rengar', '韦鲁斯': 'Varus',
    '诺提勒斯': 'Nautilus', '维克托': 'Viktor', '瑟庄妮': 'Sejuani', '菲奥娜': 'Fiora',
    '吉格斯': 'Ziggs', '璐璐': 'Lulu', '德莱文': 'Draven', '赫卡里姆': 'Hecarim',
    '卡兹克': 'Khazix', '德莱厄斯': 'Darius', '杰斯': 'Jayce', '丽桑卓': 'Lissandra',
    '黛安娜': 'Diana', '奎因': 'Quinn', '辛德拉': 'Syndra', '奥瑞利安索尔': 'AurelionSol',
    '凯隐': 'Kayn', '佐伊': 'Zoe', '婕拉': 'Zyra', '卡莎': 'KaiSa',
    '萨勒芬妮': 'Seraphine', '纳尔': 'Gnar', '扎克': 'Zac', '亚索': 'Yasuo',
    '维克兹': 'VelKoz', '塔莉垭': 'Taliyah', '卡蜜尔': 'Camille', '阿克尚': 'Akshan',
    '卑尔维斯': 'Belveth', '布隆': 'Braum', '烬': 'Jhin', '千珏': 'Kindred',
    '泽丽': 'Zeri', '金克丝': 'Jinx', '塔姆': 'TahmKench', '贝蕾亚': 'Briar',
    '佛耶戈': 'Viego', '赛娜': 'Senna', '卢锡安': 'Lucian', '劫': 'Zed',
    '克烈': 'Kled', '艾克': 'Ekko', '奇亚娜': 'Qiyana', '蔚': 'Vi',
    '亚托克斯': 'Aatrox', '娜美': 'Nami', '阿兹尔': 'Azir', '悠米': 'Yuumu',
    '莎弥拉': 'Samira', '锤石': 'Thresh', '俄洛伊': 'Illaoi', '雷克塞': 'RekSai',
    '艾翁': 'Ivern', '卡莉丝塔': 'Kalista', '巴德': 'Bard', '洛': 'Rakan', '霞': 'Xayah',
    '奥恩': 'Ornn', '塞拉斯': 'Sylas', '妮蔻': 'Neeko', '厄斐琉斯': 'Aphelios',
    '芮尔': 'Rell', '派克': 'Pyke', '薇古丝': 'Vex', '永恩': 'Yone',
    '安蓓萨': 'Ambessa', '梅尔': 'Mel', '芸阿娜': 'Alune', '瑟提': 'Sett',
    '莉莉娅': 'Lillia', '格温': 'Gwen', '烈娜塔': 'Rellita', '阿萝拉': 'Aurora',
    '尼菈': 'Nilah', '奎桑提': 'Ksante', '斯莫德': 'Smolder', '米利欧': 'Milio',
    '亚恒': 'Ahri', '彗': 'Hwei', '纳亚菲利': 'Nafiri',
    // 特殊别名
    '人马': 'Hecarim', '锤石': 'Thresh', '螳螂': 'Khazix', '大嘴': 'KogMaw',
    '狐狸': 'Ahri', '老鼠': 'Twitch', '机器人': 'Blitzcrank', '石头人': 'Malphite',
    '牛头': 'Alistar', '大树': 'Maokai', '龙女': 'Shyvana', '轮子妈': 'Sivir',
    '女警': 'Caitlyn', ' vn ': 'Vayne', '维鲁斯': 'Varus', '女枪': 'MissFortune',
    '男枪': 'Graves', 'ez': 'Ezreal', '皇子': 'JarvanIV', '剑圣': 'MasterYi',
    '武器': 'Jax', '猴子': 'Wukong', '瞎子': 'LeeSin', '德莱文兄弟': 'Draven',
    '金克斯': 'Jinx', '小法': 'Veigar', '火男': 'Brand', '冰女': 'Lissandra',
    '妖姬': 'LeBlanc', '发条': 'Ori安娜', '卡牌': 'TwistedFate', '沙皇': 'Azir',
    '蛇女': 'Cassiopeia', '乌鸦': 'Swain', '蚂蚱': 'Malzahar', '塞恩': 'Sion',
    '日女': 'Leona', '刀妹': 'Irelia', '瑞雯': 'Riven', '锐雯': 'Riven',
    '武僧': 'LeeSin', '赵信': 'XinZhao', '皇子': 'JarvanIV', '波比': 'Poppy',
    '奎因': 'Quinn', '青钢影': 'Camille', '岩雀': 'Taliyah', '霞': 'Xayah',
    '洛': 'Rakan', '巴德': 'Bard', '艾翁': 'Ivern', '千珏': 'Kindred',
    '戏命师': 'Jhin', '烬': 'Jhin', '塔莉垭': 'Taliyah', '凯隐': 'Kayn',
    '佐伊': 'Zoe', '卡莎': 'KaiSa', '奥恩': 'Ornn', '派克': 'Pyke',
    '厄斐琉斯': 'Aphelios', '赛娜': 'Senna', '悠米': 'Yuumu', '奇亚娜': 'Qiyana',
    '莉莉娅': 'Lillia', '格温': 'Gwen', '薇古丝': 'Vex', '永恩': 'Yone',
    '芮尔': 'Rell', '佛耶戈': 'Viego', '萨勒芬妮': 'Seraphine', '莎弥拉': 'Samira',
    '莉莉娅': 'Lillia', '泽丽': 'Zeri', '阿克尚': 'Akshan', '贝蕾亚': 'Briar',
    '奎桑提': 'Ksante', '阿萝拉': 'Aurora', '米利欧': 'Milio', '斯莫德': 'Smolder',
    '彗': 'Hwei', '纳亚菲利': 'Nafiri', '梅尔': 'Mel', '安蓓萨': 'Ambessa', '芸阿娜': 'Alune',
  };
}

/**
 * 根据 Data Dragon 英文 ID 获取中文名（反向映射，取第一个匹配）
 */
function getChineseName(heroId) {
  const map = getHeroIdMapping();
  for (const [cn, en] of Object.entries(map)) {
    if (en.toLowerCase() === heroId.toLowerCase()) return cn;
  }
  return heroId; // 找不到就返回原值
}

/**
 * 高频误认混淆矩阵
 * key=英雄名, value=容易被误认成的其他英雄列表
 */
function getConfusionMap() {
  return {
    '魂锁典狱长': ['战争之影', '影流之主', '虚空掠夺者', '虚空恐惧'],
    '战争之影': ['魂锁典狱长', '暗裔剑魔', '铁铠冥魂', '影流之主', '机械先驱'],
    '暗裔剑魔': ['战争之影', '铁铠冥魂', '破败之王'],
    '铁铠冥魂': ['暗裔剑魔', '战争之影', '猩红收割者'],
    '皎月女神': ['冰霜女巫', '不祥之刃'],
    '冰霜女巫': ['皎月女神', '不祥之刃'],
    '不祥之刃': ['皎月女神', '冰霜女巫', '离群之刺'],
    '影流之主': ['虚空掠夺者', '离群之刺', '魂锁典狱长', '战争之影', '机械先驱'],
    '虚空掠夺者': ['影流之主', '傲之追猎者', '虚空之眼'],
    '傲之追猎者': ['虚空掠夺者', '影流之主'],
    '离群之刺': ['影流之主', '不祥之刃', '放逐之刃'],
    '深渊巨口': ['虚空之眼', '虚空恐惧'],
    '虚空之眼': ['深渊巨口', '虚空恐惧', '双界灵兔'],
    '虚空恐惧': ['深渊巨口', '虚空之眼', '远古恐惧'],
    '猩红收割者': ['不灭狂雷', '铁铠冥魂'],
    '不灭狂雷': ['猩红收割者', '战争之影', '远古恐惧'],
    '放逐之刃': ['无双剑姬', '暗裔剑魔', '离群之刺'],
    '无双剑姬': ['放逐之刃', '青钢影'],
    '青钢影': ['无双剑姬'],
    '解脱者': ['暗裔剑魔', '铁铠冥魂', '破败之王'],
    '破败之王': ['暗裔剑魔', '铁铠冥魂', '解脱者'],
    '远古恐惧': ['虚空恐惧', '不灭狂雷'],
    '狂厄蔷薇': ['含羞蓓蕾', '荆棘之兴'],
    '含羞蓓蕾': ['狂厄蔷薇', '荆棘之兴'],
    '荆棘之兴': ['含羞蓓蕾', '狂厄蔷薇'],
    // 新增高频误认（实际遇到过的）
    '双界灵兔': ['虚空之眼', '含羞蓓蕾'],           // 兔子 ↔ 维克兹/莉莉娅
    '机械先驱': ['影流之主', '战争之影', '发条魔导师'], // 维克托 ↔ 劫/人马/发条
    '含羞蓓蕾': ['双界灵兔', '圣锤之毅', '狂厄蔷薇'],  // 莉莉娅 ↔ 兔子/波比/布莉尔
    '暮光之眼': ['狂暴之心', '影流之主'],             // 慎 ↔ 凯南/劫
    '狂暴之心': ['暮光之眼'],                         // 凯南 ↔ 慎
    '圣锤之毅': ['明烛', '含羞蓓蕾'],                 // 波比 ↔ 米利欧/莉莉娅
    '明烛': ['圣锤之毅'],                             // 米利欧 ↔ 波比
  };
}

// ========== 第一步：AI 初步识别的 System Prompt ==========
const STEP1_SYSTEM_PROMPT = `你是一个英雄联盟（LOL）比赛数据分析专家，擅长精确识别结算截图中的所有数据。

## 分析步骤：

### 第一步：观察截图整体布局
- 判断结算截图样式（对局结算、战绩详情等）
- 确认蓝方（左侧）和红方（右侧）的位置
- 确认胜负标识

### 第二步：逐个识别每位选手信息
1. **英雄名**（最重要）
2. **召唤师名称**（选手ID）
3. **KDA**：击杀(K)/死亡(D)/助攻(A)
4. **置信度评估**：你对每个英雄名的识别把握有多大？
   - "high"：非常确定，能清楚看到头像特征或文字标签
   - "medium"：基本确定，但有少量不确定
   - "low"：不太确定，头像模糊或特征不典型

### 第三步：自校验
- 蓝方和红方是否各5人？不足则重新检查
- 是否有重复英雄？（同一局不可能重复）有重复说明认错了
- 英雄名必须真实存在于LOL

## ⚠️ 易混淆英雄特别提醒（高频误认，必须仔细区分）：
- 战争之影(人马/Hecarim)：**半人马形态（四条腿+人身）**，深蓝/暗色铠甲
  - ❌ 不是锤石！锤石是人形，没有马腿。❌ 不是劫！劫是忍者。❌ 不是维克托！维克托是机械的。
- 魂锁典狱长(锤石/Thresh)：**瘦长人形，提绿色灯笼，有锁链**
  - ❌ 不是人马！人马是半人马。❌ 不是虚空之眼！大眼是多眼的悬浮生物。
- 双界灵兔(兔子/Aurora)：**白色/浅色毛茸茸兔子形象，可爱风格**
  - ❌ 不是虚空之眼(维克兹)！维克兹是紫色多眼怪物，不要因为"都有眼睛"就搞混！
- 机械先驱(维克托/Viktor)：**机械改造人，有机械臂/装置，红金配色**
  - ❌ 不是影流之主(劫)！劫是暗色忍者，无机械部件。❌ 不是人马！
- 虚空之眼(维克兹/VelKoz)：**紫色多触手/多眼，悬浮姿态，外星生物感**
  - ❌ 不是双界灵兔(兔子)！兔子是白色可爱的。❌ 不是深渊巨口(大嘴)！
- 影流之主(劫/Zed)：**暗色忍者，有面具、手里剑，黑白红配色**
  - ❌ 不是维克托！❌ 不是虚空掠夺者(螳螂)！

**识别原则：先看整体形态（人形/兽形/机械/怪物），再看标志性特征。宁可标记为 medium/low 也不要瞎猜！**

### LOL 全英雄官方列表（共172位）
识别英雄名时，**必须从以下列表中选择**，不要编造列表中不存在的英雄名。格式为「称号(常用名)」：

黑暗之女(安妮) | 狂战士(奥拉夫) | 正义巨像(加里奥) | 卡牌大师(崔斯特) | 德邦总管(赵信) | 无畏战车(厄加特) | 诡术妖姬(乐芙兰) | 猩红收割者(弗拉基米尔) | 远古恐惧(费德提克) | 正义天使(凯尔) | 无极剑圣(易) | 牛头酋长(阿利斯塔) | 符文法师(瑞兹) | 亡灵战神(赛恩) | 战争女神(希维尔) | 众星之子(索拉卡) | 迅捷斥候(提莫) | 麦林炮手(崔丝塔娜) | 祖安怒兽(沃里克) | 雪原双子(努努和威朗普) | 赏金猎人(厄运小姐) | 寒冰射手(艾希) | 蛮族之王(泰达米尔) | 武器大师(贾克斯) | 堕落天使(莫甘娜) | 时光守护者(基兰) | 炼金术士(辛吉德) | 痛苦之拥(伊芙琳) | 瘟疫之源(图奇) | 死亡颂唱者(卡尔萨斯) | 虚空恐惧(科加斯) | 殇之木乃伊(阿木木) | 披甲龙龟(拉莫斯) | 冰晶凤凰(艾尼维亚) | 恶魔小丑(萨科) | 祖安狂人(蒙多医生) | 琴瑟仙女(娑娜) | 虚空行者(卡萨丁) | 刀锋舞者(艾瑞莉娅) | 风暴之怒(迦娜) | 海洋之灾(普朗克) | 英勇投弹手(库奇) | 天启者(卡尔玛) | 瓦洛兰之盾(塔里克) | 邪恶小法师(维迦) | 巨魔之王(特朗德尔) | 诺克萨斯统领(斯维因) | 皮城女警(凯特琳) | 蒸汽机器人(布里茨) | 熔岩巨兽(墨菲特) | 不祥之刃(卡特琳娜) | 永恒梦魇(魔腾) | 扭曲树精(茂凯) | 荒漠屠夫(雷克顿) | 德玛西亚皇子(嘉文四世) | 蜘蛛女皇(伊莉丝) | 发条魔灵(奥莉安娜) | 齐天大圣(孙悟空) | 复仇焰魂(布兰德) | 盲僧(李青) | 暗夜猎手(薇恩) | 机械公敌(兰博) | 魔蛇之拥(卡西奥佩娅) | 上古领主(斯卡纳) | 大发明家(黑默丁格) | 沙漠死神(内瑟斯) | 狂野女猎手(奈德丽) | 兽灵行者(乌迪尔) | 圣锤之毅(波比) | 酒桶(古拉加斯) | 不屈之枪(潘森) | 探险家(伊泽瑞尔) | 铁铠冥魂(莫德凯撒) | 牧魂人(约里克) | 离群之刺(阿卡丽) | 狂暴之心(凯南) | 德玛西亚之力(盖伦) | 曙光女神(蕾欧娜) | 虚空先知(玛尔扎哈) | 刀锋之影(泰隆) | 放逐之刃(锐雯) | 深渊巨口(克格莫) | 暮光之眼(慎) | 光辉女郎(拉克丝) | 远古巫灵(泽拉斯) | 龙血武姬(希瓦娜) | 九尾妖狐(阿狸) | 法外狂徒(格雷福斯) | 潮汐海灵(菲兹) | 不灭狂雷(沃利贝尔) | 傲之追猎者(雷恩加尔) | 惩戒之箭(韦鲁斯) | 深海泰坦(诺提勒斯) | 机械先驱(维克托) | 北地之怒(瑟庄妮) | 无双剑姬(菲奥娜) | 爆破鬼才(吉格斯) | 仙灵女巫(璐璐) | 荣耀行刑官(德莱文) | 战争之影(赫卡里姆) | 虚空掠夺者(卡兹克) | 诺克萨斯之手(德莱厄斯) | 未来守护者(杰斯) | 冰霜女巫(丽桑卓) | 皎月女神(黛安娜) | 德玛西亚之翼(奎因) | 暗黑元首(辛德拉) | 铸星龙王(奥瑞利安索尔) | 影流之镰(凯隐) | 暮光星灵(佐伊) | 荆棘之兴(婕拉) | 虚空之女(卡莎) | 星籁歌姬(萨勒芬妮) | 迷失之牙(纳尔) | 生化魔人(扎克) | 疾风剑豪(亚索) | 虚空之眼(维克兹) | 岩雀(塔莉垭) | 青钢影(卡蜜尔) | 影哨(阿克尚) | 虚空女皇(卑尔维斯) | 弗雷尔卓德之心(布隆) | 戏命师(烬) | 永猎双子(千珏) | 祖安花火(泽丽) | 暴走萝莉(金克丝) | 河流之王(塔姆) | 狂厄蔷薇(贝蕾亚) | 破败之王(佛耶戈) | 涤魂圣枪(赛娜) | 圣枪游侠(卢锡安) | 影流之主(劫) | 暴怒骑士(克烈) | 时间刺客(艾克) | 元素女皇(奇亚娜) | 皮城执法官(蔚) | 暗裔剑魔(亚托克斯) | 唤潮鲛姬(娜美) | 沙漠皇帝(阿兹尔) | 魔法猫咪(悠米) | 沙漠玫瑰(莎弥拉) | 魂锁典狱长(锤石) | 海兽祭司(俄洛伊) | 虚空遁地兽(雷克塞) | 翠神(艾翁) | 复仇之矛(卡莉丝塔) | 星界游神(巴德) | 幻翎(洛) | 逆羽(霞) | 山隐之焰(奥恩) | 解脱者(塞拉斯) | 万花通灵(妮蔻) | 残月之肃(厄斐琉斯) | 镕铁少女(芮尔) | 血港鬼影(派克) | 愁云使者(薇古丝) | 封魔剑魂(永恩) | 铁血狼母(安蓓萨) | 流光镜影(梅尔) | 不破之誓(芸阿娜) | 腕豪(瑟提) | 含羞蓓蕾(莉莉娅) | 灵罗娃娃(格温) | 炼金男爵(烈娜塔) | 双界灵兔(阿萝拉) | 不羁之悦(尼菈) | 纳祖芒荣耀(奎桑提) | 炽炎雏龙(斯莫德) | 明烛(米利欧) | 不落魔锋(亚恒) | 异画师(彗) | 百裂冥犬(纳亚菲利)

## 返回 JSON 格式（严格遵守，只返回JSON不要其他内容）：
{
  "blue": [
    {"hero": "英雄称号", "name": "召唤师名称", "kills": "击杀", "deaths": "死亡", "assists": "助攻", "confidence": "high|medium|low"},
    ...共5人
  ],
  "red": [
    {"hero": "英雄称号", "name": "召唤师名称", "kills": "击杀", "deaths": "死亡", "assists": "助攻", "confidence": "high|medium|low"},
    ...共5人
  ],
  "winner": "blue 或 red",
  "duration": "比赛时长分钟数"
}

## 注意事项：
- hero 必须使用上面列表中的**称号**或括号内的**常用名**
- confidence 字段必填，反映你的识别把握度
- 只返回 JSON`;

/**
 * 从 COS URL 下载图片并返回 base64
 */
async function downloadImageFromUrl(url) {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error('COS download failed: ' + resp.status);
  const buf = Buffer.from(await resp.arrayBuffer());
  return buf.toString('base64');
}

// 云函数主入口
exports.main = async (event) => {
  const { image, imageUrl, correctionMemory } = event;

  // 支持两种传入方式：base64 或 COS URL
  let base64Image = image;
  if (!base64Image && imageUrl) {
    console.log('[lol-analyze] 从 COS URL 下载图片:', imageUrl);
    base64Image = await downloadImageFromUrl(imageUrl);
  }

  if (!base64Image) {
    return { success: false, error: '缺少 image 或 imageUrl 参数' };
  }

  // 如果是 data URL，去掉前缀
  if (base64Image.startsWith('data:')) {
    base64Image = base64Image.split(',')[1] || base64Image;
  }

  console.log('[lol-analyze] 收到截图识别请求, base64长度:', base64Image.length);

  // 1. 获取 API 配置
  const config = await getVisionConfig();
  if (!config) {
    return { success: false, error: 'Vision API 未配置。请在企微中发送「设置Vision」进行配置' };
  }

  const mimeType = detectMimeType(base64Image);
  const url = `${config.baseUrl}/chat/completions`;
  const commonHeaders = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${config.apiKey}`,
  };

  // ==================== 第一步：AI 初步识别 ====================
  console.log('[lol-analyze] ===== 第一步：AI初步识别 =====');
  console.log('[lol-analyze] 图片大小:', (base64Image.length/1024/1024).toFixed(2) + 'MB (base64)');

  // 构建纠错记忆提示（来自用户历史纠正）
  let correctionHint = '';
  if (correctionMemory && correctionMemory.length > 0) {
    const hints = correctionMemory
      .filter(c => c.count >= 1)
      .map(c => `- 你之前${c.count}次把"${c.correct}"错误识别为"${c.wrong}"，请特别注意区分！`)
      .join('\n');
    if (hints) {
      correctionHint = `\n\n## 🧠 历史纠错记忆（用户反馈你之前的错误，务必避免重犯！）：\n${hints}\n`;
      console.log('[lol-analyze] 注入纠错记忆:', correctionMemory.length, '条');
    }
  }

  // 将纠错记忆追加到系统 prompt
  const step1SystemPrompt = STEP1_SYSTEM_PROMPT + correctionHint;

  // 直接使用完整图片（OpenAI Vision API 支持最大 20MB）
  // 不再做 base64 截断，因为截断会破坏 JPEG/PNG 的二进制完整性
  const processedImage = base64Image;

  const step1Result = await fetchWithTimeout(url, {
    method: 'POST',
    headers: commonHeaders,
    body: JSON.stringify({
      model: config.model,
      messages: [
        { role: 'system', content: step1SystemPrompt },
        {
          role: 'user',
          content: [
            { type: 'text', text: '请仔细分析这张LOL结算截图。对每位选手的英雄名给出 confidence 置信度(high/medium/high)。只返回JSON。' },
            {
              type: 'image_url',
              image_url: { url: `data:${mimeType};base64,${processedImage}`, detail: 'high' },
            },
          ],
        },
      ],
      temperature: 0.2,
      max_tokens: 2000,
    }),
  }, 60000);

  if (step1Result.error) {
    console.error('[lol-analyze] 第一步API错误:', step1Result.error);
    return { success: false, error: step1Result.error.message || '第一步 API 调用失败' };
  }

  let step1Text = step1Result.choices?.[0]?.message?.content || '';
  console.log('[lol-analyze] 第一步原始返回:', step1Text.slice(0, 500));

  // 解析第一步 JSON
  let jsonStr = step1Text.trim();
  const jsonMatch = jsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
  if (jsonMatch) jsonStr = jsonMatch[1].trim();
  const jsonStart = jsonStr.indexOf('{');
  const jsonEnd = jsonStr.lastIndexOf('}');
  if (jsonStart >= 0 && jsonEnd > jsonStart) {
    jsonStr = jsonStr.slice(jsonStart, jsonEnd + 1);
  }

  let step1Data;
  try {
    step1Data = JSON.parse(jsonStr);
  } catch (e) {
    console.error('[lol-analyze] 第一步JSON解析失败:', e.message);
    // 尝试直接用第一步结果（可能没有 confidence 字段）
    step1Data = JSON.parse(jsonStr);
    // 补充默认 confidence
    for (const team of ['blue', 'red']) {
      if (step1Data[team]) {
        step1Data[team] = step1Data[team].map(p => ({ ...p, confidence: p.confidence || 'high' }));
      }
    }
  }

  // 确保 confidence 字段存在
  for (const team of ['blue', 'red']) {
    if (step1Data[team]) {
      step1Data[team] = step1Data[team].map(p => ({
        ...p,
        confidence: (p.confidence || 'high').toLowerCase(),
      }));
    }
  }

  console.log('[lol-analyze] 第一步解析成功');

  // 输出第一步结果供调试
  for (const team of ['blue', 'red']) {
    (step1Data[team] || []).forEach((p, i) => {
      console.log(`  [第一步] ${team}[${i}] hero=${p.hero} conf=${p.confidence} name=${p.name}`);
    });
  }

  // ==================== 第二步：低置信度 + 易混淆英雄用官方头像精确比对 ====================
  const confusionMap = getConfusionMap();
  const heroIdMap = getHeroIdMapping();
  // HERO_ICON_BASE 和 HERO_ICON_FALLBACK_BASES 已在文件顶部全局定义

  const isConfusedPair = (nameA, nameB) => {
    if (!nameA || !nameB) return false;
    return (confusionMap[nameA] || []).includes(nameB) || (confusionMap[nameB] || []).includes(nameA);
  };

  // 高频误认英雄白名单
  const HIGH_FREQ_MISIDENTIFIED_HEROES = new Set([
    '魂锁典狱长', '战争之影', '影流之主', '虚空之眼', '双界灵兔',
    '机械先驱', '虚空掠夺者', '铁铠冥魂', '暗裔剑魔',
  ]);

  // 收集需要进第二步的英雄
  const needStep2Players = [];
  for (const team of ['blue', 'red']) {
    const teamArr = step1Data[team] || [];
    teamArr.forEach((player, idx) => {
      const conf = player.confidence || 'high';
      const isUnmatched = !player.hero;
      let forceStep2Reason = null;

      if (isUnmatched) {
        forceStep2Reason = '无匹配英雄';
      } else if (conf === 'low' || conf === 'medium') {
        forceStep2Reason = `${conf}置信度`;
      } else if (HIGH_FREQ_MISIDENTIFIED_HEROES.has(player.hero)) {
        forceStep2Reason = `高频误认英雄(${player.hero})`;
      } else if (conf === 'high') {
        for (const otherTeam of ['blue', 'red']) {
          if (forceStep2Reason) break;
          for (const other of (step1Data[otherTeam] || [])) {
            if (isConfusedPair(player.hero, other.hero)) {
              forceStep2Reason = `易混淆对(${player.hero}↔${other.hero})`;
              console.log(`[lol-analyze] ⚠️ 易混淆对检测: ${team}[${idx}] "${player.hero}" 与 ${otherTeam}"${other.hero}"`);
              break;
            }
          }
        }
      }

      if (forceStep2Reason) {
        console.log(`[lol-analyze] → ${team}[${idx}] "${player.hero}" 进第二步 (${forceStep2Reason})`);
        needStep2Players.push({ team, index: idx, ...player });
      }
    });
  }

  if (needStep2Players.length === 0) {
    console.log('[lol-analyze] 所有英雄均为 high 置信度且无易混淆对，跳过第二步');
    return { success: true, data: step1Data };
  }

  console.log(`[lol-analyze] ===== 第二步：${needStep2Players.length} 个英雄需精确比对 =====`);

  // 构建候选英雄列表（去重）
  const candidateHeroes = new Set(); // 存中文英雄名

  // 🎯 形态兜底候选：确保每种形态至少有代表英雄
  // 当第一步识别完全偏离时（如把兔子认成黑默丁格），这些兜底候选提供正确的形态选项
  const MORPH_FLOOR_HEROES = [
    // 兽形/动物组
    '双界灵兔', '迷失之牙',
    // 约德尔人组
    '圣锤之毅', '狂暴之心', '明烛',
    // 正常人形组
    '暮光之眼', '影流之主', '离群之刺',
    // 机械/科技组
    '机械先驱',
    // 灵/梦幻体组
    '含羞蓓蕾',
    // 怪物/外星组
    '虚空之眼', '深渊巨口', '虚空恐惧', '战争之影', '魂锁典狱长',
  ];

  for (const player of needStep2Players) {
    if (player.hero) candidateHeroes.add(player.hero);
    // 混淆候选
    if (player.hero && confusionMap[player.hero]) {
      for (const h of confusionMap[player.hero]) candidateHeroes.add(h);
    }
    // 反向混淆候选
    if (player.hero) {
      for (const [key, list] of Object.entries(confusionMap)) {
        if (list.includes(player.hero)) candidateHeroes.add(key);
      }
    }
  }

  // 🎯 注入形态兜底英雄（确保每种核心形态都有候选）
  for (const h of MORPH_FLOOR_HEROES) {
    candidateHeroes.add(h);
  }

  console.log(`[lol-analyze] 候选英雄数: ${candidateHeroes.size}`);

  // ===== 关键改进：从 Data Dragon CDN 下载每个候选英雄的官方头像（转 base64）=====
  const downloadedIcons = [];
  for (const heroName of candidateHeroes) {
    const heroId = heroIdMap[heroName];
    if (!heroId) {
      console.log(`[lol-analyze] ⚠️ 英雄 "${heroName}" 无 Data Dragon ID，跳过`);
      continue;
    }
    const iconUrl = `${HERO_ICON_BASE}${heroId}.png`;
    try {
      console.log(`[lol-analyze] 下载头像: ${heroName} (${heroId}) from ${iconUrl}`);
      // 使用 https 模块直接下载（CloudBase 运行时的 fetch 会自动 JSON.parse，导致 PNG 解析失败）
      // 支持多版本 fallback：部分新英雄在低版本 Data Dragon 中不存在
      let base64Icon = await downloadImageWithFallback(heroId);
      if (!base64Icon || base64Icon.length < 100) throw new Error('base64 数据过短');
      downloadedIcons.push({ name: heroName, heroId, base64: base64Icon });
      console.log(`[lol-analyze] ✅ ${heroName} 头像下载成功 (${(Buffer.from(base64Icon, 'base64').length/1024).toFixed(1)}KB)`);
    } catch (e) {
      console.log(`[lol-analyze] ⚠️ ${heroName} 头像下载失败: ${e.message}`);
    }
  }

  if (downloadedIcons.length === 0) {
    console.log('[lol-analyze] 所有候选头像均下载失败，跳过第二步');
    return { success: true, data: step1Data };
  }

  console.log(`[lol-analyze] 成功下载 ${downloadedIcons.length}/${candidateHeroes.size} 个官方头像`);

  // 第二步：构建包含官方头像图片的 Vision API 请求
  // 核心改进：把候选英雄的官方头像（base64）和原始截图一起发送给 AI
  // 让 AI 通过"像素级比对"来确定正确英雄，而不是靠记忆猜测

  const step2ImageContent = [
    // 首先是原始 LOL 截图
    {
      type: 'image_url',
      image_url: { url: `data:${mimeType};base64,${processedImage}`, detail: 'high' },
    },
    // 然后是每个候选英雄的官方头像
    { type: 'text', text: '\n--- 以下是候选英雄的官方头像，请逐一与截图中待确认位置的头像做视觉对比 ---\n' },
  ];

  for (const icon of downloadedIcons) {
    step2ImageContent.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${icon.base64}`, detail: 'high' },
    });
    step2ImageContent.push({ type: 'text', text: `↑ 官方头像：${icon.name} (${icon.heroId})\n` });
  }

  const step2Prompt = `你是英雄联盟英雄头像视觉鉴定专家。任务：通过**直接观察截图中的英雄头像像素特征**与下方提供的**候选英雄官方头像**进行精确的视觉比对。

## ⚠️ 核心原则：先看整体形态分类，再看细节！
**第一步：判断截图中头像的整体形态类别**
- 🐰 兽形/可爱动物 → 优先考虑：双界灵兔(白色大兔子)
- 👧 人形/类人 → 继续分：约德尔人(矮小)、正常人类(高个)、机械改造人
- 🤖 机械/科技感 → 优先考虑：机械先驱(维克托)
- 🌿 灵/梦幻体 → 优先考虑：含羞蓓蕾(蓝紫发+鹿角)
- 🔮 怪物/外星 → 优先考虑：虚空之眼(紫色多眼)

**第二步：在同一形态类别内，比对具体特征选择最匹配的英雄**

## 待确认玩家（共 ${needStep2Players.length} 人）：
${needStep2Players.map((p, i) =>
  `${i + 1}. ${p.team.toUpperCase()}[${p.index}] 召唤师:"${p.name || '?'}" AI初步识别:"${p.hero || '?'}" 置信度:${p.confidence}`
).join('\n')}

## 比对方法：
1. 在截图中定位到每位待确认玩家的英雄头像区域（通常在召唤师名称旁边）
2. **先看整体形态**（动物？人形？机械？怪物？精灵？）
3. 再仔细观察：轮廓形状、配色方案、标志性特征
4. 与下方提供的每个候选官方头像逐一对比
5. **⚠️ 如果所有候选官方头像都与截图不匹配，你可以在 correctedHero 中填写候选列表之外的英雄名**（你已经知道所有 LOL 英雄，不要局限于提供的候选图片）

## 🎯 易混淆英雄 - 形态分类速查表（按整体形态分组）：

### 🐰 兽形/动物组：
| 英雄 | 核心特征 | 一句话辨识 |
|------|---------|-----------|
| 双界灵兔(Aurora) | **白色大兔子** + 长耳 + 毛茸茸 + 浅色/淡彩 | 看到白色毛茸茸动物 → 就是它 |
| 迷失之牙(纳尔) | **小型恐龙/怪兽** + 绿/紫色 + 尖耳朵 | 有尾巴有尖刺 → 不是兔子 |

### 👧 约德尔人组（矮小人形）：
| 英雄 | 核心特征 | 一句话辨识 |
|------|---------|-----------|
| 圣锤之毅(波比) | **粉短发** + 圆脸 + **持锤盾** | 粉色+武器 → 波比 |
| 狂暴之心(凯南) | **双手里棍** + **黄色电光**环绕 | 黄色闪电 → 凯南 |
| 明烛(米利欧) | **黄绿色小精灵** + 治愈光 + 无武器 + 可能在飞行 | 黄绿色暖光 → 米利欧 |

### 🧑 正常人形组：
| 英雄 | 核心特征 | 一句话辨识 |
|------|---------|-----------|
| 暮光之眼(慎) | **高大人形武士** + 背后大剑 + 暗绿色调 | 高大+剑 → 慎 |
| 影流之主(劫) | **忍者** + 面具 + 手里剑 + **全暗色调**无发光部件 | 暗色+面具 → 劫 |
| 离群之刺(阿卡丽) | 女忍者 + 面罩 + 暗色调 | 女性体型+暗色 → 阿卡丽 |

### 🤖 机械/科技组：
| 英雄 | 核心特征 | 一句话辨识 |
|------|---------|-----------|
| 机械先驱(维克托) | **机械改造人** + 第三条机械臂 + **红金配色** + 发光核心/装置 | 看到机械臂/发光红金 → 维克托 |

### 🌿 灵/梦幻体组：
| 英雄 | 核心特征 | 一句话辨识 |
|------|---------|-----------|
| 含羞蓓蕾(莉莉娅) | **蓝紫色长卷发** + 小鹿角 + 半透明灵体感 + 柔光 | 蓝紫发+鹿角 → 莉莉娅 |

### 🔮 怪物/外星组：
| 英雄 | 核心特征 | 一句话辨识 |
|------|---------|-----------|
| 虚空之眼(维克兹) | **紫色多触手/多眼** + 悬浮 + 外星生物 | 多眼睛+触手 → 维克兹 |
| 深渊巨口(克格莫) | **大嘴怪物** + 绿色/紫色 + 大嘴巴 | 大嘴 → 大嘴 |
| 虚空恐惧(科加斯) **: **巨型怪兽** + 多眼 + 大嘴巴 | 巨大+多眼 → 科加斯 |
| 战争之影(人马) | **半人马** + 四条马腿 + 深蓝铠甲 | 四条腿 → 人马 |
| 魂锁典狱长(锤石) | **瘦长人形** + 绿色灯笼 + 锁链 | 提灯笼 → 锤石 |

## ❌ 最常见的误认模式（遇到时必须警惕）：
1. **看到白色/浅色/毛茸茸/可爱风格 → 99% 是兔子(Aurora/双界灵兔)**！兔子是白色大耳朵毛茸茸动物，不是任何约德尔人！
   - 不是波比（波比是粉红色短发的矮人，持锤盾）
   - 不是米利欧（黄绿色小精灵）
   - 不是莉莉娅（蓝紫色长发）
   - 不是愁云使者/Vex（蓝灰色阴郁表情+遮眼刘海）
   - **如果头像是白色的、毛茸茸的、有大耳朵的动物形状 → 直接选双界灵兔(Aurora)，不要犹豫！**
2. **看到机械臂/红金发光/第三只手臂 → 是维克托(Viktor/机械先驱)，不是劫(Zed/影流之主)！**
   - 劫 = 暗色忍者 + 面具 + **纯暗色调无发光部件**
   - 维克托 = **红金色发光核心 + 机械臂装置 + 第三条手臂**
   - **仔细看截图：如果有任何红色/金色/发光/机械部件 → 选维克托！如果是全暗色/黑白红但无金属光泽 → 才是劫！**
3. **看到蓝紫色长发/鹿角 → 是莉莉娅(Lillia/含羞蓓蕾)，不是兔子、不是波比！**
4. **看到粉色短发圆脸约德尔人 + 锤盾武器 → 是波比(Poppy)，不是米利欧！**
5. **看到黄色电光环绕的小个子 → 是凯南(Kenen/狂暴之心)，不是慎（慎是高大人形武士+大剑）！**
6. **看到圆脸大眼的黄绿色/暖色小精灵无武器 → 是米利欧(Milio/明烛），不是波比！**

## 返回格式（严格JSON）：
{
  "corrections": [
    {"team": "blue/red", "index": 0, "originalHero": "AI初步识别名", "correctedHero": "纠正后的名字", "confidence": "high|medium|low", "reason": "简要说明判断依据"}
  ]
}

如果某个玩家原来的识别已经正确（即截图头像与该候选官方头像最匹配），不需要在 corrections 中列出。
只返回JSON。`;

  try {
    const step2RequestBody = {
      model: config.model,
      messages: [
        {
          role: 'system',
          content: '你是LOL英雄头像视觉鉴定专家。你将收到一张LOL结算截图和多张候选英雄的官方头像图片。请通过仔细观察和对比图片中的视觉特征（轮廓、颜色、标志性装备等）来判断每位待确认玩家的正确英雄身份。',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: step2Prompt },
            ...step2ImageContent,
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 2000,
    };

    console.log('[lol-analyze] 开始调用第二步 Vision...');
    const step2Result = await fetchWithTimeout(url, {
      method: 'POST',
      headers: commonHeaders,
      body: JSON.stringify(step2RequestBody),
    }, 90000); // 第二步超时更长

    if (step2Result.error) {
      console.error('[lol-analyze] 第二步API错误:', step2Result.error.message);
      // 第二步失败不影响，返回第一步结果
      return { success: true, data: step1Data, step2Error: step2Result.error.message };
    }

    const step2Text = step2Result.choices?.[0]?.message?.content || '';
    console.log('[lol-analyze] 第二步原始返回:', step2Text.slice(0, 1000));

    // 解析第二步结果
    let step2JsonStr = step2Text.trim();
    const step2JsonMatch = step2JsonStr.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
    if (step2JsonMatch) step2JsonStr = step2JsonMatch[1].trim();
    const s2js = step2JsonStr.indexOf('{');
    const s2je = step2JsonStr.lastIndexOf('}');
    if (s2js >= 0 && s2je > s2js) {
      step2JsonStr = step2JsonStr.slice(s2js, s2je + 1);
    }

    const step2Data = JSON.parse(step2JsonStr);
    const corrections = step2Data.corrections || [];

    console.log(`[lol-analyze] 第二步完成，共 ${corrections.length} 个纠正`);

    // 应用纠正到最终结果
    const finalData = JSON.parse(JSON.stringify(step1Data)); // 深拷贝
    for (const corr of corrections) {
      const teamArr = finalData[corr.team];
      if (teamArr && corr.index < teamArr.length) {
        const oldHero = teamArr[corr.index].hero;
        teamArr[corr.index].hero = corr.correctedHero;
        teamArr[corr.index].confidence = corr.confidence || 'high';
        console.log(`[lol-analyze] ✅ 纠正: ${corr.team}[${corr.index}] "${oldHero}" → "${corr.correctedHero}"`);
      }
    }

    return {
      success: true,
      data: finalData,
      step2Corrections: corrections,
    };

  } catch (error) {
    console.error('[lol-analyze] 第二步处理失败:', error.message);
    // 第二步异常时返回第一步结果
    return { success: true, data: step1Data, step2Error: error.message };
  }
};
