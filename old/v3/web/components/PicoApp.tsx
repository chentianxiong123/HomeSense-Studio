"use client";

import dynamic from "next/dynamic";

// PicoClaw 的 TanStack Router 依赖浏览器环境(localStorage/router context)。
// 通过 next/dynamic 关闭 SSR,首屏由客户端挂载,避免服务端 useRouterState 报错。
const PicoApp = dynamic(() => import("@/components/PicoAppInner"), {
  ssr: false,
  loading: () => null,
});

export default function PicoAppWrapper() {
  return <PicoApp />;
}