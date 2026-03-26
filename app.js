/* ============================
   LOL 内战随机器 v2.0
   ============================ */

const ROLE_ORDER = ["上路", "中路", "下路", "辅助", "打野"];

const ROLE_ICONS = {
  上路: "🗡️",
  中路: "🔮",
  下路: "🏹",
  辅助: "🛡️",
  打野: "🐾",
};

const heroPool = {
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

// 获取所有英雄列表
const ALL_HEROES = [...new Set(Object.values(heroPool).flat())].sort(
  (a, b) => a.localeCompare(b, "zh-Hans-CN")
);
const TOTAL_HEROES = ALL_HEROES.length;

// 全局状态
const usedGlobal = new Set();
const bannedHeroes = new Set();
const historyRounds = [];
let roundCount = 0;

// DOM 元素
const blueTeamEl = document.getElementById("blueTeam");
const redTeamEl = document.getElementById("redTeam");
const globalBpEl = document.getElementById("globalBp");
const statusEl = document.getElementById("status");
const usedPoolEl = document.getElementById("usedPool");
const usedCountEl = document.getElementById("usedCount");
const usedProgressEl = document.getElementById("usedProgress");
const statsGridEl = document.getElementById("statsGrid");
const banInputEl = document.getElementById("banInput");
const banSuggestionsEl = document.getElementById("banSuggestions");
const banListEl = document.getElementById("banList");
const historyModal = document.getElementById("historyModal");
const historyListEl = document.getElementById("historyList");

// ---- 工具函数 ----
function pickOne(candidates) {
  return candidates[Math.floor(Math.random() * candidates.length)];
}

function setStatus(msg, type = "") {
  statusEl.textContent = msg;
  statusEl.className = "status-bar" + (type ? " " + type : "");
}

// ---- 英雄池统计 ----
function renderStats() {
  statsGridEl.innerHTML = "";
  ROLE_ORDER.forEach((role) => {
    const total = heroPool[role].length;
    const available = heroPool[role].filter(
      (h) => !usedGlobal.has(h) && !bannedHeroes.has(h)
    ).length;

    const div = document.createElement("div");
    div.className = "stat-item";
    div.innerHTML = `
      <div class="stat-icon">${ROLE_ICONS[role]}</div>
      <div class="stat-role">${role}</div>
      <div class="stat-count">${total}</div>
      <div class="stat-avail">可用 ${available}</div>
    `;
    statsGridEl.appendChild(div);
  });
}

// ---- Ban 功能 ----
function renderBanList() {
  banListEl.innerHTML = "";
  if (bannedHeroes.size === 0) {
    banListEl.innerHTML = '<span style="color:#4a5568;font-size:12px">暂无 Ban 位</span>';
    return;
  }
  [...bannedHeroes].sort((a, b) => a.localeCompare(b, "zh-Hans-CN")).forEach((hero) => {
    const chip = document.createElement("span");
    chip.className = "ban-chip";
    chip.textContent = `✕ ${hero}`;
    chip.title = "点击取消 Ban";
    chip.addEventListener("click", () => {
      bannedHeroes.delete(hero);
      renderBanList();
      renderStats();
    });
    banListEl.appendChild(chip);
  });
}

function showSuggestions(keyword) {
  banSuggestionsEl.innerHTML = "";
  if (!keyword) return;

  const matches = ALL_HEROES.filter(
    (h) => h.includes(keyword) && !bannedHeroes.has(h)
  ).slice(0, 20);

  matches.forEach((hero) => {
    const span = document.createElement("span");
    span.className = "sug-item";
    span.textContent = hero;
    span.addEventListener("click", () => {
      bannedHeroes.add(hero);
      banInputEl.value = "";
      banSuggestionsEl.innerHTML = "";
      renderBanList();
      renderStats();
    });
    banSuggestionsEl.appendChild(span);
  });
}

banInputEl.addEventListener("input", (e) => {
  showSuggestions(e.target.value.trim());
});

banInputEl.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const val = banInputEl.value.trim();
    if (ALL_HEROES.includes(val) && !bannedHeroes.has(val)) {
      bannedHeroes.add(val);
      banInputEl.value = "";
      banSuggestionsEl.innerHTML = "";
      renderBanList();
      renderStats();
    }
  }
});

document.getElementById("clearBanBtn").addEventListener("click", () => {
  bannedHeroes.clear();
  renderBanList();
  renderStats();
});

// ---- 已上场英雄 ----
function renderUsedPool() {
  const used = Array.from(usedGlobal).sort((a, b) => a.localeCompare(b, "zh-Hans-CN"));
  usedCountEl.textContent = `${used.length} / ${TOTAL_HEROES}`;
  usedProgressEl.style.width = `${(used.length / TOTAL_HEROES) * 100}%`;

  usedPoolEl.innerHTML = "";
  used.forEach((hero) => {
    const chip = document.createElement("span");
    chip.className = "used-chip";
    chip.textContent = hero;
    usedPoolEl.appendChild(chip);
  });
}

// ---- 阵容渲染（带动画） ----
function renderTeam(node, team, delay = 0) {
  node.innerHTML = "";
  team.forEach((item, index) => {
    const li = document.createElement("li");
    li.innerHTML = `
      <div class="role-info">
        <span class="role-icon">${ROLE_ICONS[item.role]}</span>
        <span class="role-name">${item.role}</span>
      </div>
      <span class="hero-name">${item.hero}</span>
    `;
    node.appendChild(li);

    // 逐个出现动画
    setTimeout(() => {
      li.classList.add("show");
    }, delay + index * 100);
  });
}

function buildTeam(roleToHero) {
  return ROLE_ORDER.map((role) => ({ role, hero: roleToHero[role] }));
}

// ---- 生成阵容 ----
function generateLineup() {
  const enableGlobalBp = globalBpEl.checked;
  const takenThisRound = new Set();
  const blue = {};
  const red = {};

  for (const role of ROLE_ORDER) {
    const blueCandidates = heroPool[role].filter(
      (hero) =>
        !takenThisRound.has(hero) &&
        !bannedHeroes.has(hero) &&
        (!enableGlobalBp || !usedGlobal.has(hero))
    );

    if (blueCandidates.length === 0) {
      setStatus(`⚠️ 生成失败：${role}可用英雄不足，请减少 Ban 位或关闭全局 BP`, "error");
      return;
    }

    const bluePick = pickOne(blueCandidates);
    blue[role] = bluePick;
    takenThisRound.add(bluePick);

    const redCandidates = heroPool[role].filter(
      (hero) =>
        !takenThisRound.has(hero) &&
        !bannedHeroes.has(hero) &&
        (!enableGlobalBp || !usedGlobal.has(hero))
    );

    if (redCandidates.length === 0) {
      setStatus(`⚠️ 生成失败：${role}可用英雄不足，请减少 Ban 位或关闭全局 BP`, "error");
      return;
    }

    const redPick = pickOne(redCandidates);
    red[role] = redPick;
    takenThisRound.add(redPick);
  }

  const blueTeam = buildTeam(blue);
  const redTeam = buildTeam(red);

  renderTeam(blueTeamEl, blueTeam, 0);
  renderTeam(redTeamEl, redTeam, 50);

  // 更新全局 BP
  if (enableGlobalBp) {
    Object.values(blue).forEach((hero) => usedGlobal.add(hero));
    Object.values(red).forEach((hero) => usedGlobal.add(hero));
  }

  // 保存历史
  roundCount++;
  historyRounds.unshift({
    round: roundCount,
    blue: blueTeam,
    red: redTeam,
    time: new Date().toLocaleTimeString("zh-CN"),
  });

  renderUsedPool();
  renderStats();

  const bannedCount = bannedHeroes.size;
  setStatus(
    `✅ 第 ${roundCount} 轮生成成功！共 10 个不重复英雄` +
    (bannedCount > 0 ? ` · Ban ${bannedCount} 位` : "") +
    (enableGlobalBp ? ` · 已用 ${usedGlobal.size} / ${TOTAL_HEROES}` : ""),
    "success"
  );
}

// ---- 重置整局 ----
function resetGame() {
  usedGlobal.clear();
  blueTeamEl.innerHTML = "";
  redTeamEl.innerHTML = "";
  roundCount = 0;
  historyRounds.length = 0;
  renderUsedPool();
  renderStats();
  setStatus("🔄 已重置整局，所有状态已清空", "");
}

// ---- 历史记录 ----
function renderHistory() {
  historyListEl.innerHTML = "";
  if (historyRounds.length === 0) {
    historyListEl.innerHTML = '<p class="empty-hint">暂无历史记录</p>';
    return;
  }

  historyRounds.forEach((round) => {
    const div = document.createElement("div");
    div.className = "history-round";
    div.innerHTML = `
      <div class="round-title">第 ${round.round} 轮 · ${round.time}</div>
      <div class="round-teams">
        <div class="round-team blue">
          <h4>🔵 蓝色方</h4>
          <p>${round.blue.map((r) => `${r.role}: ${r.hero}`).join("<br/>")}</p>
        </div>
        <div class="round-team red">
          <h4>🔴 红色方</h4>
          <p>${round.red.map((r) => `${r.role}: ${r.hero}`).join("<br/>")}</p>
        </div>
      </div>
    `;
    historyListEl.appendChild(div);
  });
}

// ---- 事件绑定 ----
document.getElementById("generateBtn").addEventListener("click", generateLineup);
document.getElementById("resetGameBtn").addEventListener("click", resetGame);

document.getElementById("historyBtn").addEventListener("click", () => {
  renderHistory();
  historyModal.classList.add("open");
});

document.getElementById("closeModal").addEventListener("click", () => {
  historyModal.classList.remove("open");
});

historyModal.addEventListener("click", (e) => {
  if (e.target === historyModal) {
    historyModal.classList.remove("open");
  }
});

// 键盘 ESC 关闭弹窗
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    historyModal.classList.remove("open");
  }
});

// ---- 初始化 ----
renderBanList();
renderUsedPool();
renderStats();
