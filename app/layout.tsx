import type { Metadata } from "next";
import { Geist, Geist_Mono, Noto_Sans_SC } from "next/font/google";
import "katex/dist/katex.min.css";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const notoSansSC = Noto_Sans_SC({
  variable: "--font-noto-sans-sc",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  metadataBase: new URL("https://paperbee.asia"),
  title: {
    default: "PaperBee · 内部科研审核工作台",
    template: "%s · PaperBee",
  },
  description: "面向课题组与学院的私有科研项目审核、复现与版本协作空间。",
  applicationName: "PaperBee",
  openGraph: {
    title: "PaperBee · 内部科研审核工作台",
    description: "让每个结论，在提交前经得起复现与追问。",
    siteName: "PaperBee",
    type: "website",
    images: [
      {
        url: "/og.png",
        width: 1707,
        height: 907,
        alt: "PaperBee 内部科研审核工作台",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "PaperBee · 内部科研审核工作台",
    description: "让每个结论，在提交前经得起复现与追问。",
    images: ["/og.png"],
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN">
      <body className={`${geistSans.variable} ${geistMono.variable} ${notoSansSC.variable}`}>
        {children}
      </body>
    </html>
  );
}
