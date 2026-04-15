/**
 * API 配置文件
 * 
 * ⚠️ 使用方式：
 * 1. 本地开发：运行 wecom-bot-service 的 start.sh 后，
 *    把 cloudflared 生成的地址填到下面的 API_BASE
 * 2. 正式部署：填 CloudRun 部署后的域名
 * 
 * 示例：
 *   API_BASE: 'https://abc-def-ghi.trycloudflare.com'
 *   API_BASE: 'https://your-cloudrun-domain.ap-shanghai.app.tcloudbase.com'
 */

const config = {
  // 👇👇👇 把你的后端地址填在这里 👇👇👇
  API_BASE: '',
  // 👆👆👆 例如: 'https://abc-def-ghi.trycloudflare.com' 👆👆👆

  // 请求超时（毫秒）
  TIMEOUT: 60000,
};

// 如果没填地址，给出明确提示
if (!config.API_BASE) {
  console.warn('[API配置] ⚠️ API_BASE 未设置！请打开 utils/api-config.js 填写后端地址');
}

module.exports = config;
