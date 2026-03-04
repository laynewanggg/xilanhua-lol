const ROLE_ORDER = ["上路", "中路", "下路", "辅助", "打野"];

const heroPool = {
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

const usedGlobal = new Set();
const blueTeamEl = document.getElementById("blueTeam");
const redTeamEl = document.getElementById("redTeam");
const globalBpEl = document.getElementById("globalBp");
const statusEl = document.getElementById("status");
const usedPoolEl = document.getElementById("usedPool");
const usedCountEl = document.getElementById("usedCount");

function pickOne(candidates) {
  const index = Math.floor(Math.random() * candidates.length);
  return candidates[index];
}

function buildTeam(roleToHero) {
  return ROLE_ORDER.map((role) => ({ role, hero: roleToHero[role] }));
}

function renderTeam(node, team) {
  node.innerHTML = "";
  team.forEach((item) => {
    const li = document.createElement("li");
    li.innerHTML = `<span class="role">${item.role}</span><strong>${item.hero}</strong>`;
    node.appendChild(li);
  });
}

function renderUsedPool() {
  const used = Array.from(usedGlobal).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  usedCountEl.textContent = `已使用 ${used.length} 个英雄`;
  usedPoolEl.innerHTML = "";
  used.forEach((hero) => {
    const chip = document.createElement("span");
    chip.textContent = hero;
    usedPoolEl.appendChild(chip);
  });
}

function generateLineup() {
  const enableGlobalBp = globalBpEl.checked;
  const takenThisRound = new Set();
  const blue = {};
  const red = {};

  for (const role of ROLE_ORDER) {
    const blueCandidates = heroPool[role].filter(
      (hero) => !takenThisRound.has(hero) && (!enableGlobalBp || !usedGlobal.has(hero))
    );

    if (blueCandidates.length === 0) {
      statusEl.textContent = `生成失败：${role}可用英雄不足，请关闭全局 BP 或重置整局。`;
      return;
    }

    const bluePick = pickOne(blueCandidates);
    blue[role] = bluePick;
    takenThisRound.add(bluePick);

    const redCandidates = heroPool[role].filter(
      (hero) => !takenThisRound.has(hero) && (!enableGlobalBp || !usedGlobal.has(hero))
    );

    if (redCandidates.length === 0) {
      statusEl.textContent = `生成失败：${role}可用英雄不足，请关闭全局 BP 或重置整局。`;
      return;
    }

    const redPick = pickOne(redCandidates);
    red[role] = redPick;
    takenThisRound.add(redPick);
  }

  const blueTeam = buildTeam(blue);
  const redTeam = buildTeam(red);
  renderTeam(blueTeamEl, blueTeam);
  renderTeam(redTeamEl, redTeam);

  if (enableGlobalBp) {
    Object.values(blue).forEach((hero) => usedGlobal.add(hero));
    Object.values(red).forEach((hero) => usedGlobal.add(hero));
  }

  renderUsedPool();
  statusEl.textContent = `生成成功：输出顺序为上中下辅助打野（当前回合共 10 个不重复英雄）。`;
}

function resetGame() {
  usedGlobal.clear();
  blueTeamEl.innerHTML = "";
  redTeamEl.innerHTML = "";
  statusEl.textContent = "已重置整局状态。";
  renderUsedPool();
}

document.getElementById("generateBtn").addEventListener("click", generateLineup);
document.getElementById("resetGameBtn").addEventListener("click", resetGame);

renderUsedPool();
