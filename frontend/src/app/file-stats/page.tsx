"use client";

import FileStatsPanel from "@/components/FileStatsPanel";
import { PageContent, PageHeader } from "@/components/PageHeader";
import { HardDrive } from "lucide-react";

export default function FileStatsPage() {
  return (
    <>
      <PageHeader
        title="文件统计"
        description="查看书库文件格式、大小、页数与目录分布"
        icon={HardDrive}
        width="full"
      />
      <PageContent width="wide">
        <FileStatsPanel />
      </PageContent>
    </>
  );
}
