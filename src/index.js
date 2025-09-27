// 更新日期: 2025-08-25
// 更新内容:
// 1. 无论是否重定向，只要目标是 AWS S3，就自动补全 x-amz-content-sha256 和 x-amz-date
// 2. 改进Docker镜像路径处理逻辑，支持多种格式: 如 hello-world | library/hello-world | docker.io/library/hello-world
// 3. 解决大陆拉取第三方 Docker 镜像层失败的问题，自动递归处理所有 302/307 跳转，无论跳转到哪个域名，都由 Worker 继续反代，避免客户端直接访问被墙 CDN，从而提升拉取成功率
// 4. 感谢老王，处理了暗黑模式下，输入框的颜色显示问题
// 用户配置区域开始 =================================
// 以下变量用于配置代理服务的白名单和安全设置，可根据需求修改。

// ALLOWED_HOSTS: 定义允许代理的域名列表（默认白名单）。
// - 添加新域名：将域名字符串加入数组，如 'docker.io'。
// - 注意：仅支持精确匹配的域名（如 'github.com'），不支持通配符。
// - 只有列出的域名会被处理，未列出的域名将返回 400 错误。
// 示例：const ALLOWED_HOSTS = ['github.com', 'docker.io'];
const ALLOWED_HOSTS = [
  "quay.io",
  "gcr.io",
  "k8s.gcr.io",
  "registry.k8s.io",
  "ghcr.io",
  "docker.cloudsmith.io",
  "registry-1.docker.io",
  "github.com",
  "api.github.com",
  "raw.githubusercontent.com",
  "gist.github.com",
  "gist.githubusercontent.com",
  "git.openwrt.org",
];

// RESTRICT_PATHS: 控制是否限制 GitHub 和 Docker 请求的路径。
// - 设置为 true：只允许 ALLOWED_PATHS 中定义的路径关键字。
// - 设置为 false：允许 ALLOWED_HOSTS 中的所有路径。
// 示例：const RESTRICT_PATHS = true;
const RESTRICT_PATHS = false;

// ALLOWED_PATHS: 定义 GitHub 和 Docker 的允许路径关键字。
// - 添加新关键字：加入数组，如 'user-id-3' 或 'my-repo'。
// - 用于匹配请求路径（如 'library' 用于 Docker Hub 官方镜像）。
// - 路径检查对大小写不敏感，仅当 RESTRICT_PATHS = true 时生效。
// 示例：const ALLOWED_PATHS = ['library', 'my-user', 'my-repo'];
const ALLOWED_PATHS = [
  "library", // Docker Hub 官方镜像仓库的命名空间
  "user-id-1",
  "user-id-2",
];

// 用户配置区域结束 =================================

async function handleToken(realm, service, scope) {
  const tokenUrl = `${realm}?service=${service}&scope=${scope}`;
  console.log(`Fetching token from: ${tokenUrl}`);
  try {
    const tokenResponse = await fetch(tokenUrl, {
      method: "GET",
      headers: { Accept: "application/json" },
    });
    if (!tokenResponse.ok) {
      console.log(
        `Token request failed: ${tokenResponse.status} ${tokenResponse.statusText}`,
      );
      return null;
    }
    const tokenData = await tokenResponse.json();
    const token = tokenData.token || tokenData.access_token;
    if (!token) {
      console.log("No token found in response");
      return null;
    }
    console.log("Token acquired successfully");
    return token;
  } catch (error) {
    console.log(`Error fetching token: ${error.message}`);
    return null;
  }
}

function isAmazonS3(url) {
  try {
    return new URL(url).hostname.includes("amazonaws.com");
  } catch {
    return false;
  }
}

// 计算请求体的 SHA256 哈希值
async function calculateSHA256(message) {
  const encoder = new TextEncoder();
  const data = encoder.encode(message);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

// 获取空请求体的 SHA256 哈希值
function getEmptyBodySHA256() {
  return "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855";
}

/**
 * 解析请求路径，确定目标域名和路径
 * @param {URL} url - 请求的 URL 对象
 * @returns {{targetDomain: string, targetPath: string, isDockerRequest: boolean, isV2Request: boolean, v2RequestType: string | null, v2RequestTag: string | null} | null}
 */
function parseTarget(url) {
  let path = url.pathname;

  // 检查是否为 Docker V2 API 请求
  let isV2Request = false;
  let v2RequestType = null;
  let v2RequestTag = null;
  if (path.startsWith("/v2/")) {
    isV2Request = true;
    path = path.replace("/v2/", "");
    const pathSegments = path.split("/").filter(Boolean);
    if (pathSegments.length >= 3) {
      v2RequestType = pathSegments[pathSegments.length - 2];
      v2RequestTag = pathSegments[pathSegments.length - 1];
      path = pathSegments.slice(0, pathSegments.length - 2).join("/");
    }
  }

  const pathParts = path.split("/").filter(Boolean);
  if (pathParts.length < 1) return null;

  let targetDomain, targetPath;
  const fullPath = path.startsWith("/") ? path.substring(1) : path;

  if (fullPath.startsWith("https://") || fullPath.startsWith("http://")) {
    const urlObj = new URL(fullPath);
    targetDomain = urlObj.hostname;
    targetPath = urlObj.pathname.substring(1);
  } else if (pathParts[0] === "docker.io") {
    targetDomain = "registry-1.docker.io";
    targetPath =
      pathParts.length === 2
        ? `library/${pathParts[1]}`
        : pathParts.slice(1).join("/");
  } else if (ALLOWED_HOSTS.some((host) => host.includes(pathParts[0]))) {
    targetDomain = pathParts[0];
    targetPath = pathParts.slice(1).join("/");
  } else if (pathParts[0].includes(".")) {
    // 如果路径的第一部分看起来像一个域名但不在白名单中，则直接拒绝
    targetDomain = pathParts[0]; // 仅用于后续的白名单检查
    targetPath = "";
  } else if (pathParts.length >= 1 && pathParts[0] === "library") {
    targetDomain = "registry-1.docker.io";
    targetPath = pathParts.join("/");
  } else if (pathParts.length >= 2) {
    targetDomain = "registry-1.docker.io";
    targetPath = pathParts.join("/");
  } else {
    targetDomain = "registry-1.docker.io";
    targetPath = `library/${pathParts.join("/")}`;
  }

  if (targetDomain === "docker.io") {
    targetDomain = "registry-1.docker.io";
  }

  const isDockerRequest = [
    "quay.io",
    "gcr.io",
    "k8s.gcr.io",
    "registry.k8s.io",
    "ghcr.io",
    "docker.cloudsmith.io",
    "registry-1.docker.io",
  ].includes(targetDomain);

  return {
    targetDomain,
    targetPath,
    isDockerRequest,
    isV2Request,
    v2RequestType,
    v2RequestTag,
  };
}

async function handleRequest(request, redirectCount = 0, isRedirect = false) {
  const MAX_REDIRECTS = 5; // 最大重定向次数
  const url = new URL(request.url);
  let path = url.pathname;

  // 记录请求信息
  console.log(`Request: ${request.method} ${path}`);

  let targetUrl, targetDomain, isDockerRequest;

  if (isRedirect) {
    // 如果是重定向请求，直接使用请求的 URL 作为目标
    targetUrl = request.url;
    targetDomain = new URL(targetUrl).hostname;
    isDockerRequest = [
      "quay.io",
      "gcr.io",
      "k8s.gcr.io",
      "registry.k8s.io",
      "ghcr.io",
      "docker.cloudsmith.io",
      "registry-1.docker.io",
    ].includes(targetDomain);
  } else {
    // 否则，解析初始请求
    const targetInfo = parseTarget(url);
    if (!targetInfo) {
      return new Response("Invalid request: target domain or path required\n", {
        status: 400,
      });
    }

    targetDomain = targetInfo.targetDomain;
    isDockerRequest = targetInfo.isDockerRequest;

    // 默认白名单检查：只允许 ALLOWED_HOSTS 中的域名
    if (!ALLOWED_HOSTS.includes(targetDomain)) {
      console.log(`Blocked: Domain ${targetDomain} not in allowed list`);
      return new Response(`Error: Invalid target domain.\n`, { status: 400 });
    }

    // 路径白名单检查（仅当 RESTRICT_PATHS = true 时）
    if (RESTRICT_PATHS) {
      const checkPath = isDockerRequest ? targetInfo.targetPath : path;
      console.log(`Checking whitelist against path: ${checkPath}`);
      const isPathAllowed = ALLOWED_PATHS.some((pathString) =>
        checkPath.toLowerCase().includes(pathString.toLowerCase()),
      );
      if (!isPathAllowed) {
        console.log(`Blocked: Path ${checkPath} not in allowed paths`);
        return new Response(`Error: The path is not in the allowed paths.\n`, {
          status: 403,
        });
      }
    }

    // 构建目标 URL
    if (isDockerRequest) {
      if (
        targetInfo.isV2Request &&
        targetInfo.v2RequestType &&
        targetInfo.v2RequestTag
      ) {
        // 重构 V2 API URL
        targetUrl = `https://${targetDomain}/v2/${targetInfo.targetPath}/${targetInfo.v2RequestType}/${targetInfo.v2RequestTag}`;
      } else {
        targetUrl = `https://${targetDomain}/${targetInfo.isV2Request ? "v2/" : ""}${targetInfo.targetPath}`;
      }
      // 为 Docker 请求也附加查询参数
      targetUrl += url.search;
    } else {
      targetUrl = `https://${targetDomain}/${targetInfo.targetPath}${url.search}`;
    }
  }

  const newRequestHeaders = new Headers(request.headers);
  newRequestHeaders.set("Host", targetDomain);
  newRequestHeaders.delete("x-amz-content-sha256");
  newRequestHeaders.delete("x-amz-date");
  newRequestHeaders.delete("x-amz-security-token");
  newRequestHeaders.delete("x-amz-user-agent");

  if (isAmazonS3(targetUrl)) {
    newRequestHeaders.set("x-amz-content-sha256", getEmptyBodySHA256());
    newRequestHeaders.set(
      "x-amz-date",
      new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5) + "Z",
    );
  }

  try {
    // 尝试直接请求（注意：使用 manual 重定向以便我们能拦截到 307 并自己请求 S3）
    let response = await fetch(targetUrl, {
      method: request.method,
      headers: newRequestHeaders,
      body: request.body,
      redirect: "manual",
    });
    console.log(`Initial response: ${response.status} ${response.statusText}`);

    // 处理 Docker 认证挑战
    if (response.status === 401) {
      const wwwAuth = response.headers.get("WWW-Authenticate");
      if (wwwAuth) {
        const authMatch = wwwAuth.match(
          /Bearer realm="([^"]+)",service="([^"]*)",scope="([^"]*)"/,
        );
        if (authMatch) {
          const [, realm, service, scope] = authMatch;
          console.log(
            `Auth challenge: realm=${realm}, service=${service || targetDomain}, scope=${scope}`,
          );

          const token = await handleToken(
            realm,
            service || targetDomain,
            scope,
          );
          if (token) {
            console.log("Retrying with token");
            newRequestHeaders.set("Authorization", `Bearer ${token}`);
          } else {
            console.log("No token acquired, falling back to anonymous request");
            newRequestHeaders.delete("Authorization");
          }

          // 统一处理 S3 头部
          if (isAmazonS3(targetUrl)) {
            newRequestHeaders.set("x-amz-content-sha256", getEmptyBodySHA256());
            newRequestHeaders.set(
              "x-amz-date",
              new Date().toISOString().replace(/[-:T]/g, "").slice(0, -5) + "Z",
            );
          }

          response = await fetch(targetUrl, {
            method: request.method,
            headers: newRequestHeaders,
            body: request.body,
            redirect: "manual",
          });
          console.log(
            `Retry response: ${response.status} ${response.statusText}`,
          );
        } else {
          console.log("Invalid WWW-Authenticate header");
        }
      } else {
        console.log("No WWW-Authenticate header in 401 response");
      }
    }

    // 递归处理所有 301, 302, 307, 308 重定向
    if ([301, 302, 307, 308].includes(response.status)) {
      const redirectUrl = response.headers.get("Location");
      if (redirectUrl && redirectCount < MAX_REDIRECTS) {
        console.log(
          `Redirecting to: ${redirectUrl}. Count: ${redirectCount + 1}`,
        );
        // 创建一个新的请求对象来跟踪重定向
        // 注意：这里我们用 redirectUrl 替换了原始请求的 URL
        const redirectRequest = new Request(redirectUrl, {
          headers: request.headers,
          method: request.method,
          body: request.body,
          redirect: "manual",
        });
        // 递归调用 handleRequest，并增加重定向计数
        return handleRequest(redirectRequest, redirectCount + 1, true);
      } else if (redirectUrl) {
        // 达到最大重定向次数
        console.log(`Max redirects reached for ${redirectUrl}`);
        return new Response("Too many redirects", { status: 508 });
      }
    }

    // 复制响应并添加 CORS 头
    const newResponse = new Response(response.body, response);
    newResponse.headers.set("Access-Control-Allow-Origin", "*");

    // 清理可能引起问题的上游安全响应头
    newResponse.headers.delete("Content-Security-Policy");
    newResponse.headers.delete("Content-Security-Policy-Report-Only");
    newResponse.headers.delete("Clear-Site-Data");
    newResponse.headers.delete("Cross-Origin-Embedder-Policy");
    newResponse.headers.delete("Cross-Origin-Opener-Policy");
    newResponse.headers.delete("Cross-Origin-Resource-Policy");

    newResponse.headers.set(
      "Access-Control-Allow-Methods",
      "GET, HEAD, POST, OPTIONS",
    );
    newResponse.headers.set(
      "Access-Control-Allow-Headers",
      "Content-Type, Authorization",
    );

    if (isDockerRequest) {
      newResponse.headers.set(
        "Docker-Distribution-API-Version",
        "registry/2.0",
      );
      // 删除可能存在的重定向头，确保所有请求都通过Worker处理
      newResponse.headers.delete("Location");
    }
    return newResponse;
  } catch (error) {
    console.log(`Fetch error: ${error.message}`);
    return new Response(
      `Error fetching from ${targetDomain}: ${error.message}\n`,
      { status: 500 },
    );
  }
}

async function serveStaticAsset(request, env) {
  const url = new URL(request.url);
  try {
    let key = url.pathname.substring(1); // 移除开头的 '/'

    // 如果是根路径，则提供 index.html
    if (key === "") {
      key = "index.html";
    }

    // 从 KV 中获取文件内容
    const asset = await env.SITE_ASSETS.get(key, "stream");

    if (asset === null) {
      // 如果找不到，可以返回一个自定义的404页面，或者简单的文本
      return new Response("Not Found", { status: 404 });
    }

    // 根据文件扩展名设置正确的 Content-Type
    const contentType =
      {
        html: "text/html;charset=UTF-8",
        css: "text/css;charset=UTF-8",
        js: "application/javascript;charset=UTF-8",
        svg: "image/svg+xml",
      }[key.split(".").pop()] || "application/octet-stream";

    return new Response(asset, {
      headers: { "Content-Type": contentType },
    });
  } catch (e) {
    console.error(`Error serving static asset: ${e}`);
    return new Response("Error serving asset", { status: 500 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // 检查是否为 API/代理请求
    // 规则：如果路径包含多个段，或以特定前缀开头，则为 API 请求
    const isApiRequest =
      url.pathname.split("/").filter(Boolean).length > 1 ||
      url.pathname.startsWith("/v2/") ||
      url.pathname.includes("https://") ||
      ALLOWED_HOSTS.some((host) => url.pathname.startsWith(`/${host}`));

    // 如果不是 API 请求，并且是 GET 方法，则尝试从 KV 提供静态文件
    if (!isApiRequest && request.method === "GET") {
      return serveStaticAsset(request, env);
    }

    // 否则，执行原来的代理逻辑
    return handleRequest(request, 0, false);
  },
};
