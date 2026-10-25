export const developerCopy = {
  panels: {
    gatedFields: {
      title: "开发者 gated 字段",
      description:
        "集中管理各功能的开发者专属功能。默认关闭，且建议无经验用户不开启使用。",
    },
    formFillRuntime: {
      title: "填表执行参数",
      description:
        "最大并发更新组数会影响多个表格分组同时填表的数量,不建议普通用户修改。",
    },
  },
  diagnosticBundle: {
    title: "一键诊断包",
    description:
      "排查问题时不用再逐个面板导出：这里把 环境与能力总览、公开 API、启动自检、出站提示词观测、写库流水、历史楼层回放摘要 聚合成一份产物，一次带走。",
    badge: "聚合导出",
    exportJson: "导出诊断包 JSON",
    copyText: "复制诊断包文本",
    howto:
      "「复制诊断包文本」生成已脱敏的 Markdown，直接贴进酒馆聊天发给 AI；「导出诊断包 JSON」下载同内容的结构化文件（给脚本/离线分析用）。未开启观测时对应节为零记录空态，不会报错。",
  },
};
