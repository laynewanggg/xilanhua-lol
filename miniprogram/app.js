App({
  onLaunch() {
    // 初始化云开发（使用你的 CloudBase 环境）
    if (wx.cloud) {
      wx.cloud.init({
        env: 'cloud1-8gd46is1610436a9',
        traceUser: true,
      });
    }
  },
});
