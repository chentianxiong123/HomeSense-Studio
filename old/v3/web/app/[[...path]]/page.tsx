import { Suspense } from "react";
import PicoApp from "@/components/PicoApp";

// TanStack Router 在客户端接管全部路由(/,/models,/config/...)。
// catch-all 让任意路径都交给 PicoApp,客户端再决定渲染哪个页面。
export function generateStaticParams() {
  return [{ path: ["home"] }];
}

export default function Home() {
  return (
    <Suspense fallback={null}>
      <PicoApp />
    </Suspense>
  );
}