import type { Metadata } from "next";
import { AiBrowserUpload } from "./upload-form";

export const metadata: Metadata = {
  title: "AI 浏览器上传",
  description: "PaperBee 为受限 AI 运行环境提供的临时授权项目上传页。",
  openGraph: {
    title: "AI 浏览器上传 · PaperBee",
    description: "使用单次临时授权提交科研项目材料。",
    images: [],
  },
  twitter: {
    title: "AI 浏览器上传 · PaperBee",
    description: "使用单次临时授权提交科研项目材料。",
    images: [],
  },
};

export default function AiUploadPage() {
  return <AiBrowserUpload />;
}
