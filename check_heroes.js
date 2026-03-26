// 官方完整英雄列表（腾讯官方接口 hero_list.js 2026-03-18 v16.6）
// 172个独立ID（永岚=第171位英雄，含斯维因ID50和蜘蛛ID60分开计数）
const officialHeroes = [
  '安妮','奥拉夫','加里奥','卡牌','赵信','厄加特','妖姬','弗拉基米尔',
  '稻草人','天使','剑圣','牛头','瑞兹','塞恩','希维尔','索拉卡',
  '提莫','崔丝塔娜','狼人','努努','好运姐','艾希','蛮王','贾克斯',
  '莫甘娜','基兰','炼金','寡妇','老鼠','死歌','大虫子','阿木木',
  '龙龟','凤凰','小丑','蒙多','琴女','卡萨丁','刀妹','风女',
  '船长','库奇','卡尔玛','塔里克','维迦','巨魔','斯维因','女警',
  '机器人','石头人','卡特琳娜','梦魇','大树','鳄鱼','皇子','蜘蛛',
  '发条','猴子','火男','盲僧','薇恩','兰博','蛇女','蝎子',
  '大头','狗头','豹女','乌迪尔','波比','酒桶','潘森','伊泽瑞尔',
  '铁男','约里克','阿卡丽','凯南','盖伦','蕾欧娜','马尔扎哈','男刀',
  '锐雯','大嘴','慎','拉克丝','泽拉斯','希瓦娜','阿狸','男枪',
  '小鱼人','狗熊','雷恩加尔','韦鲁斯','泰坦','维克托','猪妹','剑姬',
  '炸弹人','璐璐','德莱文','人马','螳螂','诺手','杰斯','丽桑卓',
  '皎月','奎因','辛德拉','龙王','凯隐','佐伊','婕拉','卡莎',
  '塞拉芬','纳尔','扎克','亚索','维克兹','岩雀','卡蜜尔','阿克尚',
  '虚空女皇','布隆','烬','千珏','泽丽','金克丝','塔姆','贝蕾亚',
  '佛耶戈','赛娜','卢锡安','劫','克烈','艾克','奇亚娜','蔚',
  '剑魔','娜美','沙皇','悠米','莎弥拉','锤石','俄洛伊','雷克塞',
  '艾翁','卡莉丝塔','巴德','洛','霞','奥恩','塞拉斯','妮蔻',
  '厄斐琉斯','芮尔','派克','薇古丝','永恩','安蓓萨','梅尔','永岚',
  '瑟提','莉莉娅','格温','烈娜塔','阿萝拉','尼菈','奎桑提',
  '斯莫德','米利欧','兹拉特','彗','纳菲丽'
];

const officialSet = new Set(officialHeroes);
console.log('=== 官方英雄总数: ' + officialSet.size + ' ===\n');

// 检查两个文件
const fs = require('fs');

function checkFile(filename, varPattern) {
  console.log('--- 检查 ' + filename + ' ---');
  const code = fs.readFileSync(filename, 'utf8');
  const match = code.match(varPattern);
  if (!match) { console.log('未找到英雄池！'); return; }
  eval('var pool=' + match[1]);
  
  const poolAll = new Set();
  let totalSlots = 0;
  for (const [pos, heroes] of Object.entries(pool)) {
    const posSet = new Set();
    const dups = [];
    heroes.forEach(h => { if (posSet.has(h)) dups.push(h); posSet.add(h); poolAll.add(h); });
    totalSlots += heroes.length;
    console.log('  ' + pos + ': ' + heroes.length + '个' + (dups.length ? ' ⚠️重复:' + dups.join(',') : ' ✅'));
  }
  console.log('  总槽位: ' + totalSlots + ', 独立英雄: ' + poolAll.size);
  
  // 不在官方的
  const notInOfficial = [...poolAll].filter(h => !officialSet.has(h));
  if (notInOfficial.length) {
    console.log('  ❌ 不在官方列表: ' + notInOfficial.join(', '));
  }
  
  // 官方不在池中的
  const notInPool = officialHeroes.filter(h => !poolAll.has(h));
  if (notInPool.length) {
    console.log('  ❌ 官方未收录 (' + notInPool.length + '个): ' + notInPool.join(', '));
  } else {
    console.log('  ✅ 所有官方英雄均已收录！');
  }
  console.log();
}

checkFile('miniprogram/pages/index/index.js', /const HERO_POOL = (\{[\s\S]*?\});/);
checkFile('app.js', /const heroPool = (\{[\s\S]*?\});/);
