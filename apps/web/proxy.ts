import { NextResponse, type NextRequest } from "next/server";
import {
  isApiRequestAllowed,
  isApiRequestHostAllowed,
} from "@/lib/request-security";
import {
  isValidBasicAuthorization,
  isWebPasswordEnabled,
} from "@/lib/web-auth";
import { resolveAuthFromRequest } from "@/lib/auth-resolve";

/**
 * Next.js 16 替代旧 middleware.ts 的入口。跑在 Node 运行时。
 *
 * 职责(只做鉴权拦截,不做 ctx 注入):
 *   1. 请求来源信任检查(同旧版)
 *   2. PI_WEB_PASSWORD 旧单密码模式:如设置,要求 Basic Auth(向后兼容)
 *   3. 多用户模式(默认):解析 Bearer / hs_token cookie,401 拦截
 *   4. 公开端点(/api/auth/{register,login,status,me,providers})不强制 token
 *
 * ctx 注入(AsyncLocalStorage)不做在 proxy.ts:
 *   Next.js 调度 proxy.ts → route.ts 不在同一 async 上下文,
 *   ALS.getStore() 在 route.ts 里是 null。ctx 解析在每个 route.ts 入口
 *   调 resolveAuthFromRequest() 自取,见 lib/auth-resolve.ts。
 *   Phase 1.2(per-tenant 路径)会改造为 per-tenant 库单例 + request-scoped
 *   缓存(避免重复查索引库),届时再决定是否需要 ALS。
 */
export async function proxy(request: NextRequest) {
  const isApiRequest = request.nextUrl.pathname === "/api"
    || request.nextUrl.pathname.startsWith("/api/");
  const isTrustedRequest = isApiRequest
    ? isApiRequestAllowed(request)
    : isApiRequestHostAllowed(request);

  if (!isTrustedRequest) {
    if (!isApiRequest) {
      return new NextResponse("Untrusted request", { status: 403 });
    }
    return NextResponse.json({ error: "Untrusted API request" }, { status: 403 });
  }

  // 旧单密码模式:有 PI_WEB_PASSWORD 时,继续走 Basic Auth(向后兼容)
  const password = process.env.PI_WEB_PASSWORD;
  if (
    isWebPasswordEnabled(password)
    && !isValidBasicAuthorization(request.headers.get("authorization"), password)
  ) {
    return new NextResponse("Authentication required", {
      status: 401,
      headers: {
        "Cache-Control": "no-store",
        "WWW-Authenticate": 'Basic realm="Pi Web", charset="UTF-8"',
      },
    });
  }

  // 多用户模式(默认启用,无 PI_WEB_PASSWORD 时)
  // 仅对 /api/* 注入 ctx,根路径 / 走 SPA 不需要
  if (!isApiRequest) return NextResponse.next();

  // 端点白名单(不需要 token,自己处理身份):注册/登录/状态查询等
  const pathname = request.nextUrl.pathname;
  if (isAuthPublicEndpoint(pathname)) {
    return NextResponse.next();
  }

  // 解析 token(失败/缺失 → 401)
  // 例外:`/api/timeline` 允许无 token 访问(继续走默认租户,Phase 1.1
  // 阶段保持向后兼容,Phase 1.2 再做 per-tenant timeline)。
  const auth = await resolveAuthFromRequest();
  if (!auth && pathname !== "/api/timeline") {
    return NextResponse.json(
      { error: "unauthenticated", message: "需要登录" },
      { status: 401 },
    );
  }

  return NextResponse.next();
}

function isAuthPublicEndpoint(pathname: string): boolean {
  return (
    pathname === "/api/auth/register"
    || pathname === "/api/auth/login"
    || pathname === "/api/auth/logout"  // logout 公开:无 token 也能 POST 清 cookie
    || pathname === "/api/auth/status"
    || pathname === "/api/auth/me"  // me 自己也解析 token,但允许无 token(返回 authenticated:false)
    || pathname === "/api/auth/providers"
  );
}

export const config = { matcher: ["/", "/api/:path*"] };
