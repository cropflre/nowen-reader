"use client";

import LogsPanel from "@/components/LogsPanel";
import { PageContent, PageHeader } from "@/components/PageHeader";
import { AlertTriangle } from "lucide-react";

export default function LogsPage() {
  return (
    <>
      <PageHeader
        title="错误日志"
        description="查看接口异常记录并导出诊断数据"
        icon={AlertTriangle}
      />
      <PageContent width="management">
        <LogsPanel showTitle={false} />
      </PageContent>
    </>
  );
}
