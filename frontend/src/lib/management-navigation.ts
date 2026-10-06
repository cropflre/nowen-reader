export const managementItems = [
  { href: "/tag-manager", label: "标签与分类" },
  { href: "/scraper", label: "元数据抓取" },
  { href: "/file-stats", label: "文件统计" },
  { href: "/logs", label: "错误日志" },
  { href: "/data-admin", label: "数据管理" },
  { href: "/data-qa", label: "数据巡检" },
] as const;

export function isManagementPath(pathname: string) {
  return managementItems.some(({ href }) => pathname === href || pathname.startsWith(`${href}/`));
}
